import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { LockMode } from "@mikro-orm/core";
import { WagerTransaction } from "../../../domain/wagering/wager-transaction";
import { WagerTransactionEntity, WagerTransactionMapper } from "../entities/wager-transaction.entity";
import { WagerTransactionKind, WagerTransactionStatus } from "../../../domain/wagering/types";

@Injectable()
export class WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { idempotencyKey });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async findReference(
    providerId: string,
    referenceExternalTransactionId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId: referenceExternalTransactionId,
    });
    return entity ? WagerTransactionMapper.toDomain(entity) : null;
  }

  async hasReferenceBeenReverted(
    referenceId: string,
    kind: WagerTransactionKind,
  ): Promise<boolean> {
    // Check if there is already a processed refund or rollback pointing to referenceId
    const count = await this.em.count(WagerTransactionEntity, {
      referenceTransactionId: referenceId,
      kind,
      status: WagerTransactionStatus.Processed,
    });
    return count > 0;
  }

  async findPendingReferencesDue(limit: number, now: Date): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      {
        status: WagerTransactionStatus.PendingReference,
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      {
        limit,
        orderBy: { createdAt: "ASC" },
        lockMode: LockMode.PESSIMISTIC_WRITE,
        skipLocked: true,
      },
    );
    return entities.map((entity) => WagerTransactionMapper.toDomain(entity));
  }

  async save(tx: WagerTransaction): Promise<void> {
    const entity = WagerTransactionMapper.toEntity(tx);
    const existing = await this.em.findOne(WagerTransactionEntity, { id: tx.id });
    if (existing) {
      this.em.assign(existing, entity);
    } else {
      this.em.persist(entity);
    }
  }
}

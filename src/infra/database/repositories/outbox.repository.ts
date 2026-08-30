import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { OutboxMessage } from "../../../domain/messaging/outbox";
import { OutboxMessageEntity, OutboxMessageMapper } from "../entities/outbox-message.entity";
import { LockMode } from "@mikro-orm/core";

@Injectable()
export class OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async save(message: OutboxMessage): Promise<void> {
    const entity = OutboxMessageMapper.toEntity(message);
    const existing = await this.em.findOne(OutboxMessageEntity, { id: message.id });
    if (existing) {
      this.em.assign(existing, entity);
    } else {
      this.em.persist(entity);
    }
  }

  async findPendingDue(limit: number, now: Date): Promise<OutboxMessage[]> {
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [
          { nextAttemptAt: null },
          { nextAttemptAt: { $lte: now } },
        ],
      },
      {
        limit,
        orderBy: { occurredAt: "ASC" },
        lockMode: LockMode.PESSIMISTIC_WRITE,
        skipLocked: true,
      },
    );

    return entities.map((entity) => OutboxMessageMapper.toDomain(entity));
  }
}

import { Entity, PrimaryKey, Property, Unique, Enum, Index } from "@mikro-orm/core";
import { WagerTransactionKind, WagerTransactionStatus, FailureCode } from "../../../domain/wagering/types";
import { WagerTransaction } from "../../../domain/wagering/wager-transaction";

@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["providerId", "externalTransactionId"] })
@Index({ properties: ["idempotencyKey"] })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar" })
  providerId!: string;

  @Property({ type: "varchar" })
  externalTransactionId!: string;

  @Property({ type: "varchar" })
  idempotencyKey!: string;

  @Property({ type: "varchar" })
  payloadHash!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ type: "uuid" })
  playerId!: string;

  @Property({ type: "varchar" })
  roundId!: string;

  @Property({ type: "varchar" })
  gameId!: string;

  @Enum({ items: () => WagerTransactionKind })
  kind!: WagerTransactionKind;

  @Property({ type: "decimal", precision: 12, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "varchar", nullable: true })
  referenceExternalTransactionId?: string;

  @Property({ type: "uuid", nullable: true })
  referenceTransactionId?: string;

  @Property({ type: "timestamptz" })
  createdAt!: Date;

  @Enum({ items: () => WagerTransactionStatus })
  status!: WagerTransactionStatus;

  @Property({ type: "varchar", nullable: true })
  failureCode?: string;

  @Property({ type: "timestamptz", nullable: true })
  processedAt?: Date;

  @Property({ type: "int", default: 0 })
  attempts!: number;

  @Property({ type: "timestamptz", nullable: true })
  nextAttemptAt?: Date;
}

export class WagerTransactionMapper {
  static toDomain(entity: WagerTransactionEntity): WagerTransaction {
    return WagerTransaction.rehydrate({
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: entity.kind,
      money: {
        amount: entity.amount,
        currency: entity.currency,
      },
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: entity.status,
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode as FailureCode | undefined,
      processedAt: entity.processedAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
    });
  }

  static toEntity(domain: WagerTransaction): WagerTransactionEntity {
    const entity = new WagerTransactionEntity();
    entity.id = domain.id;
    entity.providerId = domain.providerId;
    entity.externalTransactionId = domain.externalTransactionId;
    entity.idempotencyKey = domain.idempotencyKey;
    entity.payloadHash = domain.payloadHash;
    entity.walletId = domain.walletId;
    entity.playerId = domain.playerId;
    entity.roundId = domain.roundId;
    entity.gameId = domain.gameId;
    entity.kind = domain.kind;
    entity.amount = domain.money.toJSON().amount;
    entity.currency = domain.money.currency;
    entity.referenceExternalTransactionId = domain.referenceExternalTransactionId;
    entity.referenceTransactionId = domain.referenceTransactionId;
    entity.createdAt = domain.createdAt;
    entity.status = domain.status;
    entity.failureCode = domain.failureCode;
    entity.processedAt = domain.processedAt;
    entity.attempts = domain.attempts;
    entity.nextAttemptAt = domain.nextAttemptAt;
    return entity;
  }
}

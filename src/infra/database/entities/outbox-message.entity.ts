import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";
import { OutboxMessage } from "../../../domain/messaging/outbox";

@Entity({ tableName: "outbox_messages" })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  aggregateId!: string;

  @Property({ type: "varchar" })
  eventType!: string;

  @Property({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Property({ type: "timestamptz" })
  occurredAt!: Date;

  @Property({ type: "int" })
  attempts!: number;

  @Property({ type: "timestamptz", nullable: true })
  @Index()
  nextAttemptAt?: Date;

  @Property({ type: "timestamptz", nullable: true })
  @Index()
  publishedAt?: Date;
}

export class OutboxMessageMapper {
  static toDomain(entity: OutboxMessageEntity): OutboxMessage {
    return OutboxMessage.rehydrate({
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
    });
  }

  static toEntity(domain: OutboxMessage): OutboxMessageEntity {
    const entity = new OutboxMessageEntity();
    entity.id = domain.id;
    entity.aggregateId = domain.aggregateId;
    entity.eventType = domain.eventType;
    // Cast payload as Record<string, unknown> because domain.payload is Readonly<Record<string, unknown>>
    entity.payload = domain.payload as Record<string, unknown>;
    entity.occurredAt = domain.occurredAt;
    entity.attempts = domain.attempts;
    entity.nextAttemptAt = domain.nextAttemptAt;
    entity.publishedAt = domain.publishedAt;
    return entity;
  }
}

import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { InboxMessage } from "../../../domain/messaging/inbox";

@Entity({ tableName: "inbox_messages" })
@Unique({ properties: ["consumerName", "messageId"] })
export class InboxMessageEntity {
  @PrimaryKey({ type: "varchar" })
  messageId!: string;

  @Property({ type: "varchar" })
  consumerName!: string;

  @Property({ type: "varchar" })
  payloadHash!: string;

  @Property({ type: "timestamptz" })
  receivedAt!: Date;

  @Property({ type: "timestamptz", nullable: true })
  processedAt?: Date;
}

export class InboxMessageMapper {
  static toDomain(entity: InboxMessageEntity): InboxMessage {
    return InboxMessage.rehydrate({
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    });
  }

  static toEntity(domain: InboxMessage): InboxMessageEntity {
    const entity = new InboxMessageEntity();
    entity.messageId = domain.messageId;
    entity.consumerName = domain.consumerName;
    entity.payloadHash = domain.payloadHash;
    entity.receivedAt = domain.receivedAt;
    entity.processedAt = domain.processedAt;
    return entity;
  }
}

import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { InboxMessage } from "../../../domain/messaging/inbox";
import { InboxMessageEntity, InboxMessageMapper } from "../entities/inbox-message.entity";

@Injectable()
export class InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(consumerName: string, messageId: string): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, { consumerName, messageId });
    return entity ? InboxMessageMapper.toDomain(entity) : null;
  }

  async save(message: InboxMessage): Promise<void> {
    const entity = InboxMessageMapper.toEntity(message);
    const existing = await this.em.findOne(InboxMessageEntity, {
      consumerName: message.consumerName,
      messageId: message.messageId,
    });
    if (existing) {
      this.em.assign(existing, entity);
    } else {
      this.em.persist(entity);
    }
  }
}

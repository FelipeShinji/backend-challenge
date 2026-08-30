import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { OutboxRepository } from "../database/repositories/outbox.repository";
import { OutboxMessageEntity } from "../database/entities/outbox-message.entity";
import { SqsClient } from "./sqs-client";
import { MetricsService } from "../observability/metrics.service";
import { CreateQueueCommand } from "@aws-sdk/client-sqs";

@Injectable()
export class OutboxWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private isRunning = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly em: EntityManager,
    private readonly outboxRepo: OutboxRepository,
    private readonly sqsClient: SqsClient,
    private readonly metricsService: MetricsService,
  ) {}


  async onApplicationBootstrap() {
    this.isRunning = true;
    try {
      await this.sqsClient.getClient().send(
        new CreateQueueCommand({
          QueueName: "integration-events.fifo",
          Attributes: {
            FifoQueue: "true",
            ContentBasedDeduplication: "false",
          },
        }),
      );
    } catch (err) {
      // Ignora se já existe
    }
    this.poll();
  }

  async onApplicationShutdown() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
    }
  }

  private poll() {
    if (!this.isRunning) return;

    this.processBatch()
      .catch((err) => this.logger.error("Erro no processamento da outbox", err))
      .finally(() => {
        if (this.isRunning) {
          this.timer = setTimeout(() => this.poll(), 500);
        }
      });
  }

  async processBatch(): Promise<void> {
    const now = new Date();
    const batchSize = 10;

    // Report Outbox Lag
    try {
      const lag = await this.em.count(OutboxMessageEntity, { publishedAt: null });
      this.metricsService.setOutboxLag(lag);
    } catch (lagErr) {
      // Ignora erro ao contar para não parar o processamento principal
    }

    const messagesToPublish = await this.em.transactional(async () => {
      const messages = await this.outboxRepo.findPendingDue(batchSize, now);
      if (messages.length === 0) return [];

      for (const msg of messages) {
        msg.scheduleRetry(now); // Incrementa tentativas e define próximo envio temporário
        await this.outboxRepo.save(msg);
      }
      return messages;
    });

    if (messagesToPublish.length === 0) return;

    for (const msg of messagesToPublish) {
      try {
        await this.sqsClient.publish(
          "integration-events.fifo",
          JSON.stringify(msg.payload),
          msg.aggregateId, // MessageGroupId
          msg.id,          // MessageDeduplicationId
        );

        await this.em.transactional(async () => {
          msg.markPublished(new Date());
          await this.outboxRepo.save(msg);
        });
      } catch (err) {
        this.logger.error(`Falha ao publicar mensagem outbox ${msg.id}`, err);
        this.metricsService.incrementRetry("outbox");
        // O agendamento feito no scheduleRetry já garante a retentativa.
      }
    }
  }
}

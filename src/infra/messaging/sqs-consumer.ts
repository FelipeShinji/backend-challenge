import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from "@nestjs/common";
import { SqsClient } from "./sqs-client";
import { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from "@aws-sdk/client-sqs";
import { EntityManager } from "@mikro-orm/postgresql";
import { InboxRepository } from "../database/repositories/inbox.repository";
import { InboxMessage } from "../../domain/messaging/inbox";
import { WageringService } from "../../modules/wagering/wagering.service";
import { Money } from "../../domain/money/money";
import { WagerTransactionKind } from "../../domain/wagering/types";
import { LoggerContext } from "../observability/logger-context";
import { MetricsService } from "../observability/metrics.service";
import { randomUUID } from "crypto";

@Injectable()
export class SqsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumer.name);
  private isRunning = false;
  private inFlightCount = 0;
  private readonly consumerName = "wager-transactions-consumer";
  private readonly queueName = "wager-transactions.fifo";

  constructor(
    private readonly sqsClient: SqsClient,
    private readonly em: EntityManager,
    private readonly inboxRepo: InboxRepository,
    private readonly wageringService: WageringService,
    private readonly metricsService: MetricsService,
  ) {}


  async onApplicationBootstrap() {
    this.isRunning = true;
    this.poll();
  }

  async onApplicationShutdown() {
    this.isRunning = false;
    let attempts = 0;
    while (this.inFlightCount > 0 && attempts < 10) {
      this.logger.log(`Aguardando ${this.inFlightCount} mensagens em andamento terminarem...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      attempts++;
    }
  }

  private poll() {
    if (!this.isRunning) return;

    this.receiveMessages()
      .catch((err) => this.logger.error("Erro na leitura da fila SQS", err))
      .finally(() => {
        if (this.isRunning) {
          // Pequena pausa para evitar CPU spinning quando a fila está vazia
          setTimeout(() => this.poll(), 100);
        }
      });
  }

  private async receiveMessages() {
    const endpoint = process.env.SQS_ENDPOINT || "http://localhost:4566";
    const queueUrl = `${endpoint}/000000000000/${this.queueName}`;

    try {
      const command = new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 5,
        WaitTimeSeconds: 5,
        AttributeNames: ["ApproximateReceiveCount"],
      });

      const response = await this.sqsClient.getClient().send(command);

      if (!response.Messages || response.Messages.length === 0) {
        return;
      }

      const promises = response.Messages.map((msg) => this.handleMessage(msg, queueUrl));
      await Promise.all(promises);
    } catch (err) {
      this.logger.error("Erro ao receber mensagens do SQS", err);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async handleMessage(msg: any, queueUrl: string) {
    this.inFlightCount++;
    const startTime = Date.now();
    try {
      const body = JSON.parse(msg.Body || "{}");
      const { messageId, type, occurredAt, data } = body;

      if (type !== "WagerTransactionRequested" || !data) {
        this.logger.warn(`Mensagem ignorada por tipo desconhecido: ${type}`);
        await this.deleteMessage(msg.ReceiptHandle, queueUrl);
        return;
      }

      const receiveCount = Number(msg.Attributes?.ApproximateReceiveCount || 1);
      if (receiveCount > 1) {
        this.metricsService.incrementRetry("sqs");
      }
      if (receiveCount >= 5) {
        this.metricsService.incrementDlq();
      }

      const idempotencyKey = data.idempotencyKey || `${data.providerId}:${data.externalTransactionId}`;

      await LoggerContext.run(
        {
          messageId,
          correlationId: idempotencyKey,
          providerId: data.providerId,
          walletId: data.walletId,
        },
        async () => {
          const payloadHash = this.wageringService.calculatePayloadHash(data);

          const processed = await this.em.transactional(async () => {
            let inboxMsg = await this.inboxRepo.findById(this.consumerName, messageId);
            if (inboxMsg) {
              if (inboxMsg.isProcessed()) {
                return true;
              }
            } else {
              inboxMsg = InboxMessage.receive({
                messageId,
                consumerName: this.consumerName,
                payloadHash,
              });
              await this.inboxRepo.save(inboxMsg);
            }

            await this.wageringService.submitTransactionInternal({
              id: data.id || randomUUID(),
              providerId: data.providerId,
              externalTransactionId: data.externalTransactionId,
              idempotencyKey,
              payloadHash,
              walletId: data.walletId,
              playerId: data.playerId,
              roundId: data.roundId,
              gameId: data.gameId,
              kind: data.kind as WagerTransactionKind,
              money: Money.from({ amount: data.money.amount, currency: data.money.currency }),
              referenceExternalTransactionId: data.referenceExternalTransactionId,
              createdAt: new Date(occurredAt || Date.now()),
            });

            inboxMsg.markProcessed(new Date());
            await this.inboxRepo.save(inboxMsg);
            return false;
          });

          if (processed) {
            this.metricsService.incrementDuplicate();
            this.logger.log(`Mensagem duplicada SQS detectada e ignorada: ${messageId}`);
          }

          this.metricsService.recordLatency(Date.now() - startTime);
          await this.deleteMessage(msg.ReceiptHandle, queueUrl);
        },
      );
    } catch (err) {
      this.logger.error(`Erro ao processar mensagem SQS ${msg.MessageId}`, err);
      try {
        await this.sqsClient.getClient().send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: queueUrl,
            ReceiptHandle: msg.ReceiptHandle,
            VisibilityTimeout: 0,
          }),
        );
      } catch (visErr) {
        // ignora
      }
    } finally {
      this.inFlightCount--;
    }
  }

  private async deleteMessage(receiptHandle: string, queueUrl: string) {
    await this.sqsClient.getClient().send(
      new DeleteMessageCommand({
        QueueUrl: queueUrl,
        ReceiptHandle: receiptHandle,
      }),
    );
  }
}

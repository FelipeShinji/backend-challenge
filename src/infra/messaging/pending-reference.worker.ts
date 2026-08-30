import { Injectable, OnApplicationBootstrap, OnApplicationShutdown, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { WagerTransactionRepository } from "../database/repositories/wager-transaction.repository";
import { WageringService } from "../../modules/wagering/wagering.service";

@Injectable()
export class PendingReferenceWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PendingReferenceWorker.name);
  private isRunning = false;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly em: EntityManager,
    private readonly wagerTxRepo: WagerTransactionRepository,
    private readonly wageringService: WageringService,
  ) {}

  async onApplicationBootstrap() {
    this.isRunning = true;
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
      .catch((err) => this.logger.error("Erro no reprocessamento de referências pendentes", err))
      .finally(() => {
        if (this.isRunning) {
          this.timer = setTimeout(() => this.poll(), 1000);
        }
      });
  }

  async processBatch(): Promise<void> {
    const now = new Date();
    const batchSize = 10;

    const dueTxList = await this.em.transactional(async () => {
      return await this.wagerTxRepo.findPendingReferencesDue(batchSize, now);
    });

    for (const tx of dueTxList) {
      try {
        await this.wageringService.reprocessPendingReference(tx.id);
      } catch (err) {
        this.logger.error(`Erro ao reprocessar transação pendente de referência ${tx.id}`, err);
      }
    }
  }
}

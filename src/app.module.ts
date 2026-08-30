import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import mikroOrmConfig from "./infra/database/mikro-orm.config";

// Entities
import { WalletEntity } from "./infra/database/entities/wallet.entity";
import { WagerTransactionEntity } from "./infra/database/entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "./infra/database/entities/wallet-ledger-entry.entity";
import { InboxMessageEntity } from "./infra/database/entities/inbox-message.entity";
import { OutboxMessageEntity } from "./infra/database/entities/outbox-message.entity";

// Repositories
import { WalletRepository } from "./infra/database/repositories/wallet.repository";
import { WagerTransactionRepository } from "./infra/database/repositories/wager-transaction.repository";
import { LedgerRepository } from "./infra/database/repositories/ledger.repository";
import { InboxRepository } from "./infra/database/repositories/inbox.repository";
import { OutboxRepository } from "./infra/database/repositories/outbox.repository";

// Messaging & Workers
import { SqsClient } from "./infra/messaging/sqs-client";
import { OutboxWorker } from "./infra/messaging/outbox.worker";
import { PendingReferenceWorker } from "./infra/messaging/pending-reference.worker";
import { SqsConsumer } from "./infra/messaging/sqs-consumer";

// Controllers & Services
import { WalletsController } from "./modules/wallets/wallets.controller";
import { WalletsService } from "./modules/wallets/wallets.service";
import { WageringController } from "./modules/wagering/wagering.controller";
import { WageringService } from "./modules/wagering/wagering.service";
import { HealthController } from "./modules/health/health.controller";

// Observability
import { JsonLoggerService } from "./infra/observability/json-logger";
import { MetricsService } from "./infra/observability/metrics.service";
import { MetricsController } from "./infra/observability/metrics.controller";
import { LoggerContextMiddleware } from "./infra/observability/logger-context.middleware";

@Module({
  imports: [
    MikroOrmModule.forRoot(mikroOrmConfig),
    MikroOrmModule.forFeature([
      WalletEntity,
      WagerTransactionEntity,
      WalletLedgerEntryEntity,
      InboxMessageEntity,
      OutboxMessageEntity,
    ]),
  ],
  controllers: [
    WalletsController, 
    WageringController, 
    HealthController,
    MetricsController,
  ],
  providers: [
    // Repositories
    WalletRepository,
    WagerTransactionRepository,
    LedgerRepository,
    InboxRepository,
    OutboxRepository,

    // Messaging & Workers
    SqsClient,
    OutboxWorker,
    PendingReferenceWorker,
    SqsConsumer,

    // Services
    WalletsService,
    WageringService,

    // Observability
    JsonLoggerService,
    MetricsService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(LoggerContextMiddleware)
      .forRoutes("*");
  }
}


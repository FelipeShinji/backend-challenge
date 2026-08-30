import "dotenv/config";
import { defineConfig } from "@mikro-orm/postgresql";
import { WalletEntity } from "./entities/wallet.entity";
import { WagerTransactionEntity } from "./entities/wager-transaction.entity";
import { WalletLedgerEntryEntity } from "./entities/wallet-ledger-entry.entity";
import { InboxMessageEntity } from "./entities/inbox-message.entity";
import { OutboxMessageEntity } from "./entities/outbox-message.entity";

export default defineConfig({
  entities: [
    WalletEntity,
    WagerTransactionEntity,
    WalletLedgerEntryEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  dbName: process.env.DB_NAME || "wagering_db",
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || "wagering",
  password: process.env.DB_PASSWORD || "wagering",
  migrations: {
    path: "./dist/infra/database/migrations",
    pathTs: "./src/infra/database/migrations",
    disableForeignKeys: false, // Maintain referential integrity
  },
});

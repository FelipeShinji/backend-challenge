import { Migration } from "@mikro-orm/migrations";

export class Migration20260829120000 extends Migration {
  async up(): Promise<void> {
    // 1. Wallets
    this.addSql(`
      CREATE TABLE "wallets" (
        "id" UUID NOT NULL PRIMARY KEY,
        "player_id" UUID NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance_amount" DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        "version" INT NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL,
        "updated_at" TIMESTAMPTZ NOT NULL,
        CONSTRAINT "uq_wallets_player_id_currency" UNIQUE ("player_id", "currency"),
        CONSTRAINT "chk_wallets_balance_amount_non_negative" CHECK ("balance_amount" >= 0.00)
      );
    `);

    // 2. Wager Transactions
    this.addSql(`
      CREATE TABLE "wager_transactions" (
        "id" UUID NOT NULL PRIMARY KEY,
        "provider_id" VARCHAR(255) NOT NULL,
        "external_transaction_id" VARCHAR(255) NOT NULL,
        "idempotency_key" VARCHAR(255) NOT NULL,
        "payload_hash" VARCHAR(255) NOT NULL,
        "wallet_id" UUID NOT NULL,
        "player_id" UUID NOT NULL,
        "round_id" VARCHAR(255) NOT NULL,
        "game_id" VARCHAR(255) NOT NULL,
        "kind" VARCHAR(50) NOT NULL,
        "amount" DECIMAL(12, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "reference_external_transaction_id" VARCHAR(255) NULL,
        "reference_transaction_id" UUID NULL,
        "created_at" TIMESTAMPTZ NOT NULL,
        "status" VARCHAR(50) NOT NULL,
        "failure_code" VARCHAR(100) NULL,
        "processed_at" TIMESTAMPTZ NULL,
        "attempts" INT NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NULL,
        CONSTRAINT "uq_wager_transactions_provider_external" UNIQUE ("provider_id", "external_transaction_id"),
        CONSTRAINT "uq_wager_transactions_idempotency_key" UNIQUE ("idempotency_key")
      );
    `);
    this.addSql(`CREATE INDEX "idx_wager_transactions_status" ON "wager_transactions" ("status");`);
    this.addSql(`CREATE INDEX "idx_wager_transactions_wallet_id" ON "wager_transactions" ("wallet_id");`);

    // 3. Wallet Ledger Entries
    this.addSql(`
      CREATE TABLE "wallet_ledger_entries" (
        "id" UUID NOT NULL PRIMARY KEY,
        "wallet_id" UUID NOT NULL,
        "transaction_id" UUID NOT NULL,
        "direction" VARCHAR(10) NOT NULL,
        "amount" DECIMAL(12, 2) NOT NULL,
        "currency" VARCHAR(3) NOT NULL,
        "balance_before" DECIMAL(12, 2) NOT NULL,
        "balance_after" DECIMAL(12, 2) NOT NULL,
        "created_at" TIMESTAMPTZ NOT NULL
      );
    `);
    this.addSql(`CREATE INDEX "idx_wallet_ledger_entries_wallet_id" ON "wallet_ledger_entries" ("wallet_id");`);
    this.addSql(`CREATE INDEX "idx_wallet_ledger_entries_wallet_created" ON "wallet_ledger_entries" ("wallet_id", "created_at" DESC, "id" DESC);`);

    // 4. Inbox Messages
    this.addSql(`
      CREATE TABLE "inbox_messages" (
        "message_id" VARCHAR(255) NOT NULL,
        "consumer_name" VARCHAR(255) NOT NULL,
        "payload_hash" VARCHAR(255) NOT NULL,
        "received_at" TIMESTAMPTZ NOT NULL,
        "processed_at" TIMESTAMPTZ NULL,
        PRIMARY KEY ("message_id", "consumer_name")
      );
    `);

    // 5. Outbox Messages
    this.addSql(`
      CREATE TABLE "outbox_messages" (
        "id" UUID NOT NULL PRIMARY KEY,
        "aggregate_id" UUID NOT NULL,
        "event_type" VARCHAR(255) NOT NULL,
        "payload" JSONB NOT NULL,
        "occurred_at" TIMESTAMPTZ NOT NULL,
        "attempts" INT NOT NULL DEFAULT 0,
        "next_attempt_at" TIMESTAMPTZ NULL,
        "published_at" TIMESTAMPTZ NULL
      );
    `);
    this.addSql(`CREATE INDEX "idx_outbox_messages_published_next" ON "outbox_messages" ("published_at", "next_attempt_at") WHERE "published_at" IS NULL;`);
  }

  async down(): Promise<void> {
    this.addSql('DROP TABLE IF EXISTS "outbox_messages" CASCADE;');
    this.addSql('DROP TABLE IF EXISTS "inbox_messages" CASCADE;');
    this.addSql('DROP TABLE IF EXISTS "wallet_ledger_entries" CASCADE;');
    this.addSql('DROP TABLE IF EXISTS "wager_transactions" CASCADE;');
    this.addSql('DROP TABLE IF EXISTS "wallets" CASCADE;');
  }
}

import { Migration } from "@mikro-orm/migrations";

/**
 * Adiciona a constraint que faltava: no máximo um lançamento de ledger
 * por transação financeira, por wallet. Sem isso, um retry raro na
 * camada de aplicação poderia teoricamente inserir dois lançamentos
 * para a mesma WagerTransaction, quebrando a invariante
 * "toda alteração de saldo tem um lançamento correspondente no ledger
 * (e vice-versa)" da seção 6.2 do desafio.
 */
export class Migration20260829130000 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE "wallet_ledger_entries"
      ADD CONSTRAINT "uq_wallet_ledger_entries_wallet_transaction"
      UNIQUE ("wallet_id", "transaction_id");
    `);
  }

  async down(): Promise<void> {
    this.addSql(`
      ALTER TABLE "wallet_ledger_entries"
      DROP CONSTRAINT "uq_wallet_ledger_entries_wallet_transaction";
    `);
  }
}

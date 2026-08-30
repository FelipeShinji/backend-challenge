import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";
import { WalletLedgerEntryEntity, WalletLedgerEntryMapper } from "../entities/wallet-ledger-entry.entity";
import { LedgerDirection } from "../../../domain/wagering/types";
import Decimal from "decimal.js";

@Injectable()
export class LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    const entity = WalletLedgerEntryMapper.toEntity(entry);
    this.em.persist(entity);
  }

  async findPaginatedByWalletId(
    walletId: string,
    limit: number,
    cursor?: string,
  ): Promise<{ entries: WalletLedgerEntry[]; nextCursor?: string }> {
    const qb = this.em.createQueryBuilder(WalletLedgerEntryEntity);
    qb.select("*").where({ walletId });

    if (cursor) {
      try {
        const decoded = JSON.parse(Buffer.from(cursor, "base64").toString("utf-8"));
        const cursorDate = new Date(decoded.createdAt);
        const cursorId = decoded.id;

        qb.andWhere(
          `("createdAt" < ? OR ("createdAt" = ? AND id < ?))`,
          [cursorDate, cursorDate, cursorId],
        );
      } catch (err) {
        // Se o cursor for inválido, ignora ou lança erro. Vamos ignorar.
      }
    }

    qb.orderBy({ createdAt: "DESC", id: "DESC" }).limit(limit + 1);

    const entities = await qb.execute<WalletLedgerEntryEntity[]>();
    const hasMore = entities.length > limit;
    const results = hasMore ? entities.slice(0, limit) : entities;

    let nextCursor: string | undefined = undefined;
    if (hasMore && results.length > 0) {
      const last = results[results.length - 1];
      const cursorObj = { createdAt: last.createdAt.toISOString(), id: last.id };
      nextCursor = Buffer.from(JSON.stringify(cursorObj)).toString("base64");
    }

    const domainEntries = results.map((e) => {
      // MikroORM raw query output may have snake_case keys or camelCase depending on mapping.
      // Let's rehydrate them carefully.
      return WalletLedgerEntry.rehydrate({
        id: e.id,
        walletId: e.walletId,
        transactionId: e.transactionId,
        direction: e.direction,
        money: { amount: String(e.amount), currency: e.currency },
        balanceBefore: { amount: String(e.balanceBefore), currency: e.currency },
        balanceAfter: { amount: String(e.balanceAfter), currency: e.currency },
        createdAt: new Date(e.createdAt),
      });
    });

    return { entries: domainEntries, nextCursor };
  }

  async countEntriesByWalletId(walletId: string): Promise<number> {
    return this.em.count(WalletLedgerEntryEntity, { walletId });
  }

  async sumBalanceByWalletId(walletId: string): Promise<string> {
    const knex = this.em.getKnex();
    const result = await knex("wallet_ledger_entries")
      .select(
        knex.raw(
          "COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0) as balance",
        ),
      )
      .where("wallet_id", walletId)
      .first();

    return new Decimal(result.balance || 0).toFixed(2);
  }
}

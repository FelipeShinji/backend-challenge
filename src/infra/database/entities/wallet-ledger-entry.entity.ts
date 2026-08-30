import { Entity, PrimaryKey, Property, Enum } from "@mikro-orm/core";
import { LedgerDirection } from "../../../domain/wagering/types";
import { WalletLedgerEntry } from "../../../domain/wallet/wallet-ledger-entry";

@Entity({ tableName: "wallet_ledger_entries" })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  walletId!: string;

  @Property({ type: "uuid" })
  transactionId!: string;

  @Enum({ items: () => LedgerDirection })
  direction!: LedgerDirection;

  @Property({ type: "decimal", precision: 12, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 12, scale: 2 })
  balanceBefore!: string;

  @Property({ type: "decimal", precision: 12, scale: 2 })
  balanceAfter!: string;

  @Property({ type: "timestamptz" })
  createdAt!: Date;
}

export class WalletLedgerEntryMapper {
  static toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    return WalletLedgerEntry.rehydrate({
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: entity.direction,
      money: { amount: entity.amount, currency: entity.currency },
      balanceBefore: { amount: entity.balanceBefore, currency: entity.currency },
      balanceAfter: { amount: entity.balanceAfter, currency: entity.currency },
      createdAt: entity.createdAt,
    });
  }

  static toEntity(domain: WalletLedgerEntry): WalletLedgerEntryEntity {
    const entity = new WalletLedgerEntryEntity();
    entity.id = domain.id;
    entity.walletId = domain.walletId;
    entity.transactionId = domain.transactionId;
    entity.direction = domain.direction;
    entity.amount = domain.money.toJSON().amount;
    entity.currency = domain.money.currency;
    entity.balanceBefore = domain.balanceBefore.toJSON().amount;
    entity.balanceAfter = domain.balanceAfter.toJSON().amount;
    entity.createdAt = domain.createdAt;
    return entity;
  }
}

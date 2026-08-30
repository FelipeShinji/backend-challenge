import { Entity, PrimaryKey, Property, Unique } from "@mikro-orm/core";
import { Wallet } from "../../../domain/wallet/wallet";

@Entity({ tableName: "wallets" })
@Unique({ properties: ["playerId", "currency"] })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid" })
  playerId!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({ type: "decimal", precision: 12, scale: 2 })
  balanceAmount!: string;

  @Property({ type: "int" })
  version!: number;

  @Property({ type: "timestamptz" })
  createdAt!: Date;

  @Property({ type: "timestamptz" })
  updatedAt!: Date;
}

export class WalletMapper {
  static toDomain(entity: WalletEntity): Wallet {
    return Wallet.rehydrate({
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: {
        amount: entity.balanceAmount,
        currency: entity.currency,
      },
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
  }

  static toEntity(domain: Wallet): WalletEntity {
    const entity = new WalletEntity();
    entity.id = domain.id;
    entity.playerId = domain.playerId;
    entity.currency = domain.currency;
    entity.balanceAmount = domain.balance.toJSON().amount;
    entity.version = domain.version;
    entity.createdAt = domain.createdAt;
    entity.updatedAt = domain.updatedAt;
    return entity;
  }
}

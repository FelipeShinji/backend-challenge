import { Injectable } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { Wallet } from "../../../domain/wallet/wallet";
import { WalletEntity, WalletMapper } from "../entities/wallet.entity";
import { LockMode } from "@mikro-orm/core";

@Injectable()
export class WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string, lock = false): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    );
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
    lock = false,
  ): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { playerId, currency: currency.toUpperCase() },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    );
    return entity ? WalletMapper.toDomain(entity) : null;
  }

  async save(wallet: Wallet): Promise<void> {
    const entity = WalletMapper.toEntity(wallet);
    // Use em.assign to handle updates, or em.upsert/em.persist
    const existing = await this.em.findOne(WalletEntity, { id: wallet.id });
    if (existing) {
      this.em.assign(existing, entity);
    } else {
      this.em.persist(entity);
    }
  }
}

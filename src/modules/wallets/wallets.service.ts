import { Injectable, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletRepository } from "../../infra/database/repositories/wallet.repository";
import { LedgerRepository } from "../../infra/database/repositories/ledger.repository";
import { WagerTransactionRepository } from "../../infra/database/repositories/wager-transaction.repository";
import { OutboxRepository } from "../../infra/database/repositories/outbox.repository";
import { Wallet } from "../../domain/wallet/wallet";
import { Money } from "../../domain/money/money";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { OutboxMessage } from "../../domain/messaging/outbox";
import { WalletBalanceChanged, WagerTransactionProcessed } from "../../domain/messaging/events";
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from "../../domain/wagering/types";
import { randomUUID } from "crypto";

@Injectable()
export class WalletsService {
  private readonly logger = new Logger(WalletsService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly wagerTxRepo: WagerTransactionRepository,
    private readonly outboxRepo: OutboxRepository,
  ) {}

  async createWallet(playerId: string, initialAmount: string, currency: string): Promise<Wallet> {
    return await this.em.transactional(async () => {
      const existing = await this.walletRepo.findByPlayerIdAndCurrency(playerId, currency);
      if (existing) {
        throw new HttpException("Wallet já existente para o player e moeda especificados", HttpStatus.CONFLICT);
      }

      const walletId = randomUUID();
      const initialBalance = Money.from({ amount: initialAmount, currency });
      const wallet = Wallet.open({
        id: walletId,
        playerId,
        initialBalance,
      });

      await this.walletRepo.save(wallet);

      if (initialBalance.isPositive()) {
        const txId = randomUUID();
        const correlationId = txId;

        const openingTx = WagerTransaction.rehydrate({
          id: txId,
          providerId: "system",
          externalTransactionId: `opening-${walletId}`,
          idempotencyKey: `opening:${walletId}`,
          payloadHash: "opening",
          walletId: walletId,
          playerId: playerId,
          roundId: "opening",
          gameId: "system",
          kind: WagerTransactionKind.Opening,
          money: initialBalance.toJSON(),
          createdAt: new Date(),
          status: WagerTransactionStatus.Processed,
          processedAt: new Date(),
          attempts: 0,
        });
        await this.wagerTxRepo.save(openingTx);

        const ledgerEntry = WalletLedgerEntry.create({
          id: randomUUID(),
          walletId: walletId,
          transactionId: txId,
          direction: LedgerDirection.Credit,
          money: initialBalance,
          balanceBefore: Money.zero(currency),
          balanceAfter: initialBalance,
        });
        await this.ledgerRepo.save(ledgerEntry);

        const processedEvent = new WagerTransactionProcessed({
          eventId: randomUUID(),
          aggregateId: txId,
          correlationId,
          occurredAt: new Date(),
          data: {
            transactionId: txId,
            providerId: "system",
            externalTransactionId: `opening-${walletId}`,
            walletId: walletId,
            playerId: playerId,
            roundId: "opening",
            gameId: "system",
            kind: WagerTransactionKind.Opening,
            money: initialBalance.toJSON(),
            status: WagerTransactionStatus.Processed,
            processedAt: openingTx.processedAt!,
          },
        });

        const balanceChangedEvent = new WalletBalanceChanged({
          eventId: randomUUID(),
          aggregateId: walletId,
          correlationId,
          occurredAt: new Date(),
          data: {
            walletId,
            transactionId: txId,
            direction: LedgerDirection.Credit,
            money: initialBalance.toJSON(),
            balanceBefore: Money.zero(currency).toJSON(),
            balanceAfter: initialBalance.toJSON(),
            walletVersion: wallet.version,
          },
        });

        await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));
        await this.outboxRepo.save(OutboxMessage.enqueue(balanceChangedEvent));
      }

      return wallet;
    });
  }

  async getWallet(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new HttpException("Wallet não encontrada", HttpStatus.NOT_FOUND);
    }
    return wallet;
  }

  async getLedger(walletId: string, limit: number, cursor?: string) {
    await this.getWallet(walletId);
    return await this.ledgerRepo.findPaginatedByWalletId(walletId, limit, cursor);
  }

  async auditReconciliation(walletId: string) {
    const wallet = await this.getWallet(walletId);
    const calculatedBalance = await this.ledgerRepo.sumBalanceByWalletId(walletId);
    const storedBalance = wallet.balance.toJSON().amount;
    const consistent = calculatedBalance === storedBalance;
    const checkedEntries = await this.ledgerRepo.countEntriesByWalletId(walletId);

    const diffVal = parseFloat(storedBalance) - parseFloat(calculatedBalance);
    const difference = {
      amount: diffVal.toFixed(2),
      currency: wallet.currency,
    };

    if (!consistent) {
      this.logger.warn(
        `Divergência de reconciliação na wallet ${walletId}: Saldo armazenado ${storedBalance}, Saldo calculado ${calculatedBalance}`,
      );
    }

    return {
      walletId,
      storedBalance: wallet.balance.toJSON(),
      calculatedBalance: { amount: calculatedBalance, currency: wallet.currency },
      difference,
      consistent,
      checkedEntries,
    };
  }
}

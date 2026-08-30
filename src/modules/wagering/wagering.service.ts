import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { LockMode } from "@mikro-orm/core";
import { WalletRepository } from "../../infra/database/repositories/wallet.repository";
import { WagerTransactionRepository } from "../../infra/database/repositories/wager-transaction.repository";
import { LedgerRepository } from "../../infra/database/repositories/ledger.repository";
import { OutboxRepository } from "../../infra/database/repositories/outbox.repository";
import { Money, MoneyProps } from "../../domain/money/money";
import { Wallet } from "../../domain/wallet/wallet";
import { WagerTransaction } from "../../domain/wagering/wager-transaction";
import { WalletLedgerEntry } from "../../domain/wallet/wallet-ledger-entry";
import { OutboxMessage } from "../../domain/messaging/outbox";
import {
  WagerTransactionProcessed,
  WalletBalanceChanged,
  WagerTransactionPendingReference,
  WagerTransactionRejected,
} from "../../domain/messaging/events";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
  LedgerDirection,
  FailureCode,
} from "../../domain/wagering/types";
import { WalletLedgerEntryEntity } from "../../infra/database/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity, WagerTransactionMapper } from "../../infra/database/entities/wager-transaction.entity";
import { LoggerContext } from "../../infra/observability/logger-context";
import { MetricsService } from "../../infra/observability/metrics.service";
import { createHash, randomUUID } from "crypto";


export class BusinessRejectionException extends Error {
  constructor(public readonly code: FailureCode) {
    super(`Wager transaction rejected: ${code}`);
    this.name = "BusinessRejectionException";
  }
}

export class IdempotencyConflictException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdempotencyConflictException";
  }
}

export class CurrencyMismatchException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CurrencyMismatchException";
  }
}

export class WalletNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletNotFoundException";
  }
}

@Injectable()
export class WageringService {
  private readonly logger = new Logger(WageringService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: WalletRepository,
    private readonly wagerTxRepo: WagerTransactionRepository,
    private readonly ledgerRepo: LedgerRepository,
    private readonly outboxRepo: OutboxRepository,
    private readonly metricsService: MetricsService,
  ) {}

  calculatePayloadHash(data: any): string {
    const businessData = {
      providerId: data.providerId,
      externalTransactionId: data.externalTransactionId,
      playerId: data.playerId,
      walletId: data.walletId,
      roundId: data.roundId,
      gameId: data.gameId,
      kind: data.kind,
      money: data.money
        ? {
            amount: data.money.amount,
            currency: data.money.currency,
          }
        : undefined,
      referenceExternalTransactionId: data.referenceExternalTransactionId,
    };

    const canonicalString = this.canonicalJsonStringify(businessData);
    return createHash("sha256").update(canonicalString).digest("hex");
  }

  private canonicalJsonStringify(obj: any): string {
    if (obj === null) return "null";
    if (typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) {
      return "[" + obj.map((item) => this.canonicalJsonStringify(item)).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    const keyValPairs = keys
      .filter((key) => obj[key] !== undefined)
      .map((key) => `"${key}":${this.canonicalJsonStringify(obj[key])}`);
    return "{" + keyValPairs.join(",") + "}";
  }

  async submitTransactionInternal(props: {
    id: string;
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    payloadHash: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    referenceExternalTransactionId?: string;
    createdAt: Date;
  }): Promise<{
    transactionId: string;
    status: WagerTransactionStatus;
    balance: MoneyProps;
    idempotentReplay: boolean;
  }> {
    return LoggerContext.run(
      {
        correlationId: props.idempotencyKey,
        providerId: props.providerId,
        walletId: props.walletId,
        transactionId: props.id,
      },
      async () => {
        const startTime = Date.now();
        try {
          // 1. Idempotency Check
          const existing = await this.wagerTxRepo.findByIdempotencyKey(props.idempotencyKey);
          if (existing) {
            if (!existing.matchesPayload(props.payloadHash)) {
              throw new IdempotencyConflictException(
                "A mesma chave de idempotência foi submetida com outro payload",
              );
            }

            const wallet = await this.walletRepo.findById(props.walletId);
            if (!wallet) {
              throw new WalletNotFoundException("Wallet não encontrada");
            }

            let observedBalance = wallet.balance.toJSON();
            if (existing.status === WagerTransactionStatus.Processed && existing.affectsBalance()) {
              const ledgerEntry = await this.em.findOne(WalletLedgerEntryEntity, {
                transactionId: existing.id,
              });
              if (ledgerEntry) {
                observedBalance = { amount: ledgerEntry.balanceAfter, currency: ledgerEntry.currency };
              }
            }

            this.metricsService.incrementDuplicate();
            this.metricsService.recordLatency(Date.now() - startTime);

            return {
              transactionId: existing.id,
              status: existing.status,
              balance: observedBalance,
              idempotentReplay: true,
            };
          }

          // 2. Lock and load wallet
          const wallet = await this.walletRepo.findById(props.walletId, true);
          if (!wallet) {
            throw new WalletNotFoundException("Wallet não encontrada");
          }

          // Check currency mismatch
          if (wallet.currency !== props.money.currency) {
            throw new CurrencyMismatchException("Moeda da transação não confere com a da wallet");
          }

          // Create wager transaction in PENDING state
          const wagerTx = WagerTransaction.create({
            id: props.id,
            providerId: props.providerId,
            externalTransactionId: props.externalTransactionId,
            idempotencyKey: props.idempotencyKey,
            payloadHash: props.payloadHash,
            walletId: props.walletId,
            playerId: props.playerId,
            roundId: props.roundId,
            gameId: props.gameId,
            kind: props.kind,
            money: props.money,
            referenceExternalTransactionId: props.referenceExternalTransactionId,
            createdAt: props.createdAt,
          });
          await this.wagerTxRepo.save(wagerTx);

          // Apply the transaction rules
          await this.executeTransactionRules(wagerTx, wallet);

          // Save wallet changes
          await this.walletRepo.save(wallet);

          this.metricsService.incrementTransaction(wagerTx.status, props.kind);
          this.metricsService.recordLatency(Date.now() - startTime);

          return {
            transactionId: wagerTx.id,
            status: wagerTx.status,
            balance: wallet.balance.toJSON(),
            idempotentReplay: false,
          };
        } catch (err) {
          this.metricsService.recordLatency(Date.now() - startTime);
          const msg = String(err?.message || "").toLowerCase();
          if (
            msg.includes("deadlock") ||
            msg.includes("lock timeout") ||
            msg.includes("lock conflict") ||
            msg.includes("concurrent update") ||
            msg.includes("serialization failure")
          ) {
            this.metricsService.incrementLockConflict();
          }
          throw err;
        }
      },
    );
  }


  private async executeTransactionRules(tx: WagerTransaction, wallet: Wallet): Promise<void> {
    const correlationId = tx.id;

    try {
      if (tx.requiresReference()) {
        // REFUND / ROLLBACK
        const ref = await this.wagerTxRepo.findReference(
          tx.providerId,
          tx.referenceExternalTransactionId!,
        );
        if (!ref) {
          tx.markPendingReference();
          await this.wagerTxRepo.save(tx);

          const event = new WagerTransactionPendingReference({
            eventId: randomUUID(),
            aggregateId: tx.id,
            correlationId,
            occurredAt: new Date(),
            data: {
              transactionId: tx.id,
              providerId: tx.providerId,
              externalTransactionId: tx.externalTransactionId,
              walletId: tx.walletId,
              playerId: tx.playerId,
              roundId: tx.roundId,
              gameId: tx.gameId,
              kind: tx.kind,
              money: tx.money.toJSON(),
              status: tx.status,
              referenceExternalTransactionId: tx.referenceExternalTransactionId!,
              pendingSince: tx.createdAt,
            },
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
          return;
        }

        if (ref.status !== WagerTransactionStatus.Processed) {
          tx.markPendingReference();
          await this.wagerTxRepo.save(tx);
          return;
        }

        if (
          ref.playerId !== tx.playerId ||
          ref.walletId !== tx.walletId ||
          ref.money.currency !== tx.money.currency ||
          ref.roundId !== tx.roundId
        ) {
          throw new BusinessRejectionException("REFERENCE_WRONG_KIND");
        }

        const alreadyReverted = await this.wagerTxRepo.hasReferenceBeenReverted(ref.id, tx.kind);
        if (alreadyReverted) {
          throw new BusinessRejectionException("REFERENCE_ALREADY_REVERSED");
        }

        if (tx.kind === WagerTransactionKind.Refund) {
          if (ref.kind !== WagerTransactionKind.Bet) {
            throw new BusinessRejectionException("REFERENCE_WRONG_KIND");
          }
          if (!ref.money.equals(tx.money)) {
            throw new BusinessRejectionException("REFERENCE_WRONG_KIND");
          }

          const balanceBefore = wallet.balance;
          wallet.credit(tx.money);
          const balanceAfter = wallet.balance;

          tx.markProcessed(ref.id, new Date());
          await this.wagerTxRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money: tx.money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          await this.enqueueProcessedEvents(tx, wallet, ledgerEntry, correlationId);
        } else if (tx.kind === WagerTransactionKind.Rollback) {
          if (
            ref.kind !== WagerTransactionKind.Bet &&
            ref.kind !== WagerTransactionKind.Win &&
            ref.kind !== WagerTransactionKind.Refund
          ) {
            throw new BusinessRejectionException("REFERENCE_WRONG_KIND");
          }
          if (!ref.money.equals(tx.money)) {
            throw new BusinessRejectionException("REFERENCE_WRONG_KIND");
          }

          const originalDirection = ref.ledgerDirectionFor();
          const targetDirection =
            originalDirection === LedgerDirection.Debit
              ? LedgerDirection.Credit
              : LedgerDirection.Debit;

          const balanceBefore = wallet.balance;

          if (targetDirection === LedgerDirection.Debit) {
            if (wallet.balance.isLessThan(tx.money)) {
              throw new BusinessRejectionException("REVERSAL_WOULD_GO_NEGATIVE");
            }
            wallet.debit(tx.money);
          } else {
            wallet.credit(tx.money);
          }

          const balanceAfter = wallet.balance;
          tx.markProcessed(ref.id, new Date());
          await this.wagerTxRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: targetDirection,
            money: tx.money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          await this.enqueueProcessedEvents(tx, wallet, ledgerEntry, correlationId);
        }
      } else {
        // BET, WIN, LOSS
        if (tx.kind === WagerTransactionKind.Bet) {
          if (wallet.balance.isLessThan(tx.money)) {
            throw new BusinessRejectionException("INSUFFICIENT_BALANCE");
          }

          const balanceBefore = wallet.balance;
          wallet.debit(tx.money);
          const balanceAfter = wallet.balance;

          tx.markProcessed(undefined, new Date());
          await this.wagerTxRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Debit,
            money: tx.money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          await this.enqueueProcessedEvents(tx, wallet, ledgerEntry, correlationId);
        } else if (tx.kind === WagerTransactionKind.Win) {
          const balanceBefore = wallet.balance;
          wallet.credit(tx.money);
          const balanceAfter = wallet.balance;

          let referenceId: string | undefined = undefined;
          if (tx.referenceExternalTransactionId) {
            const ref = await this.wagerTxRepo.findReference(
              tx.providerId,
              tx.referenceExternalTransactionId,
            );
            if (ref && ref.roundId === tx.roundId) {
              referenceId = ref.id;
            }
          }

          tx.markProcessed(referenceId, new Date());
          await this.wagerTxRepo.save(tx);

          const ledgerEntry = WalletLedgerEntry.create({
            id: randomUUID(),
            walletId: wallet.id,
            transactionId: tx.id,
            direction: LedgerDirection.Credit,
            money: tx.money,
            balanceBefore,
            balanceAfter,
          });
          await this.ledgerRepo.save(ledgerEntry);

          await this.enqueueProcessedEvents(tx, wallet, ledgerEntry, correlationId);
        } else if (tx.kind === WagerTransactionKind.Loss) {
          tx.markProcessed(undefined, new Date());
          await this.wagerTxRepo.save(tx);

          const event = new WagerTransactionProcessed({
            eventId: randomUUID(),
            aggregateId: tx.id,
            correlationId,
            occurredAt: new Date(),
            data: {
              transactionId: tx.id,
              providerId: tx.providerId,
              externalTransactionId: tx.externalTransactionId,
              walletId: tx.walletId,
              playerId: tx.playerId,
              roundId: tx.roundId,
              gameId: tx.gameId,
              kind: tx.kind,
              money: tx.money.toJSON(),
              status: tx.status,
              processedAt: tx.processedAt!,
            },
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
        }
      }
    } catch (err) {
      if (err instanceof BusinessRejectionException) {
        tx.reject(err.code);
        await this.wagerTxRepo.save(tx);

        const event = new WagerTransactionRejected({
          eventId: randomUUID(),
          aggregateId: tx.id,
          correlationId,
          occurredAt: new Date(),
          data: {
            transactionId: tx.id,
            providerId: tx.providerId,
            externalTransactionId: tx.externalTransactionId,
            walletId: tx.walletId,
            playerId: tx.playerId,
            roundId: tx.roundId,
            gameId: tx.gameId,
            kind: tx.kind,
            money: tx.money.toJSON(),
            status: tx.status,
            failureCode: tx.failureCode!,
            rejectedAt: new Date(),
          },
        });
        await this.outboxRepo.save(OutboxMessage.enqueue(event));
      } else {
        throw err;
      }
    }
  }

  private async enqueueProcessedEvents(
    tx: WagerTransaction,
    wallet: Wallet,
    ledgerEntry: WalletLedgerEntry,
    correlationId: string,
  ): Promise<void> {
    const processedEvent = new WagerTransactionProcessed({
      eventId: randomUUID(),
      aggregateId: tx.id,
      correlationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        status: tx.status,
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
        referenceTransactionId: tx.referenceTransactionId,
        processedAt: tx.processedAt!,
      },
    });

    const balanceChangedEvent = new WalletBalanceChanged({
      eventId: randomUUID(),
      aggregateId: wallet.id,
      correlationId,
      occurredAt: new Date(),
      data: {
        walletId: wallet.id,
        transactionId: tx.id,
        direction: ledgerEntry.direction,
        money: tx.money.toJSON(),
        balanceBefore: ledgerEntry.balanceBefore.toJSON(),
        balanceAfter: ledgerEntry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });

    await this.outboxRepo.save(OutboxMessage.enqueue(processedEvent));
    await this.outboxRepo.save(OutboxMessage.enqueue(balanceChangedEvent));
  }

  async reprocessPendingReference(txId: string): Promise<void> {
    await this.em.transactional(async () => {
      const txEntity = await this.em.findOne(WagerTransactionEntity, { id: txId }, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
      if (!txEntity || txEntity.status !== WagerTransactionStatus.PendingReference) {
        return;
      }
      const tx = WagerTransactionMapper.toDomain(txEntity);

      const wallet = await this.walletRepo.findById(tx.walletId, true);
      if (!wallet) {
        throw new WalletNotFoundException("Wallet não encontrada");
      }

      const ref = await this.wagerTxRepo.findReference(
        tx.providerId,
        tx.referenceExternalTransactionId!,
      );
      const now = new Date();

      const MAX_ATTEMPTS = 5;
      const TTL_MS = 5 * 60 * 1000;

      if (!ref || ref.status !== WagerTransactionStatus.Processed) {
        const elapsed = now.getTime() - tx.createdAt.getTime();
        if (elapsed > TTL_MS || tx.attempts >= MAX_ATTEMPTS) {
          tx.reject("REFERENCE_NOT_FOUND");
          await this.wagerTxRepo.save(tx);
          this.metricsService.incrementTransaction(tx.status, tx.kind);

          const event = new WagerTransactionRejected({
            eventId: randomUUID(),
            aggregateId: tx.id,
            correlationId: tx.id,
            occurredAt: new Date(),
            data: {
              transactionId: tx.id,
              providerId: tx.providerId,
              externalTransactionId: tx.externalTransactionId,
              walletId: tx.walletId,
              playerId: tx.playerId,
              roundId: tx.roundId,
              gameId: tx.gameId,
              kind: tx.kind,
              money: tx.money.toJSON(),
              status: tx.status,
              failureCode: tx.failureCode!,
              rejectedAt: new Date(),
            },
          });
          await this.outboxRepo.save(OutboxMessage.enqueue(event));
        } else {
          tx.scheduleRetry(now);
          await this.wagerTxRepo.save(tx);
          this.metricsService.incrementRetry("pending-reference");
        }
        return;
      }

      await this.executeTransactionRules(tx, wallet);
      await this.walletRepo.save(wallet);
      this.metricsService.incrementTransaction(tx.status, tx.kind);
    });
  }
}

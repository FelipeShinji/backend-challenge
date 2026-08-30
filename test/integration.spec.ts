import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletsService } from "../src/modules/wallets/wallets.service";
import { WageringService } from "../src/modules/wagering/wagering.service";
import { WalletRepository } from "../src/infra/database/repositories/wallet.repository";
import { LedgerRepository } from "../src/infra/database/repositories/ledger.repository";
import { WagerTransactionRepository } from "../src/infra/database/repositories/wager-transaction.repository";
import { Money } from "../src/domain/money/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../src/domain/wagering/types";
import { randomUUID } from "crypto";

describe("Integration Tests", () => {
  let moduleRef: TestingModule;
  let em: EntityManager;
  let walletsService: WalletsService;
  let wageringService: WageringService;
  let walletRepo: WalletRepository;
  let ledgerRepo: LedgerRepository;
  let wagerTxRepo: WagerTransactionRepository;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    await moduleRef.init();
    em = moduleRef.get(EntityManager);
    walletsService = moduleRef.get(WalletsService);
    wageringService = moduleRef.get(WageringService);
    walletRepo = moduleRef.get(WalletRepository);
    ledgerRepo = moduleRef.get(LedgerRepository);
    wagerTxRepo = moduleRef.get(WagerTransactionRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("abre wallet, executa BET, WIN, REFUND e verifica invariantes", async () => {
    const playerId = randomUUID();

    // 1. Criar wallet com saldo de 1000.00
    const wallet = await walletsService.createWallet(playerId, "1000.00", "BRL");
    expect(wallet.balance.toJSON().amount).toBe("1000.00");

    // 2. Executar uma BET de 100.00
    const idempotencyKey1 = `bet-${randomUUID()}`;
    const payload1 = {
      providerId: "provider-test",
      externalTransactionId: randomUUID(),
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "slots",
      kind: "BET",
      money: { amount: "100.00", currency: "BRL" },
    };
    const hash1 = wageringService.calculatePayloadHash(payload1);

    const betRes = await em.transactional(async () => {
      return await wageringService.submitTransactionInternal({
        id: randomUUID(),
        ...payload1,
        idempotencyKey: idempotencyKey1,
        payloadHash: hash1,
        kind: WagerTransactionKind.Bet,
        money: Money.from(payload1.money),
        createdAt: new Date(),
      });
    });

    expect(betRes.status).toBe(WagerTransactionStatus.Processed);
    expect(betRes.balance.amount).toBe("900.00");

    // 3. Executar replay idêntico da BET (deve ser idempotente)
    const replayRes = await em.transactional(async () => {
      return await wageringService.submitTransactionInternal({
        id: randomUUID(),
        ...payload1,
        idempotencyKey: idempotencyKey1,
        payloadHash: hash1,
        kind: WagerTransactionKind.Bet,
        money: Money.from(payload1.money),
        createdAt: new Date(),
      });
    });
    expect(replayRes.idempotentReplay).toBe(true);
    expect(replayRes.balance.amount).toBe("900.00");

    // 4. Executar replay com payload conflitante (deve falhar com erro de idempotência)
    const payloadConflict = { ...payload1, gameId: "slots-diferente" };
    const hashConflict = wageringService.calculatePayloadHash(payloadConflict);
    
    let conflictErrorThrown = false;
    try {
      await em.transactional(async () => {
        await wageringService.submitTransactionInternal({
          id: randomUUID(),
          ...payloadConflict,
          idempotencyKey: idempotencyKey1,
          payloadHash: hashConflict,
          kind: WagerTransactionKind.Bet,
          money: Money.from(payloadConflict.money),
          createdAt: new Date(),
        });
      });
    } catch (err) {
      conflictErrorThrown = true;
    }
    expect(conflictErrorThrown).toBe(true);

    // 5. Executar WIN de 250.00 referenciando a BET
    const winIdempotencyKey = `win-${randomUUID()}`;
    const payloadWin = {
      providerId: "provider-test",
      externalTransactionId: randomUUID(),
      playerId,
      walletId: wallet.id,
      roundId: "round-1",
      gameId: "slots",
      kind: "WIN",
      money: { amount: "250.00", currency: "BRL" },
      referenceExternalTransactionId: payload1.externalTransactionId,
    };
    const hashWin = wageringService.calculatePayloadHash(payloadWin);

    const winRes = await em.transactional(async () => {
      return await wageringService.submitTransactionInternal({
        id: randomUUID(),
        ...payloadWin,
        idempotencyKey: winIdempotencyKey,
        payloadHash: hashWin,
        kind: WagerTransactionKind.Win,
        money: Money.from(payloadWin.money),
        createdAt: new Date(),
      });
    });
    expect(winRes.status).toBe(WagerTransactionStatus.Processed);
    expect(winRes.balance.amount).toBe("1150.00");

    // 6. Verificar reconciliação e invariante final
    const recon = await em.transactional(async () => {
      return await walletsService.auditReconciliation(wallet.id);
    });
    expect(recon.consistent).toBe(true);
    expect(recon.difference.amount).toBe("0.00");
  });

  it("reprocessa referências fora de ordem (REFUND antes da BET)", async () => {
    const playerId = randomUUID();
    const wallet = await walletsService.createWallet(playerId, "500.00", "BRL");

    const betExternalId = `bet-ext-${randomUUID()}`;
    const refundIdempotency = `refund-${randomUUID()}`;

    // 1. Submeter REFUND de 50.00 antes da BET existir
    const payloadRefund = {
      providerId: "provider-test",
      externalTransactionId: randomUUID(),
      playerId,
      walletId: wallet.id,
      roundId: "round-2",
      gameId: "slots",
      kind: "REFUND",
      money: { amount: "50.00", currency: "BRL" },
      referenceExternalTransactionId: betExternalId,
    };
    const hashRefund = wageringService.calculatePayloadHash(payloadRefund);

    const refundRes = await em.transactional(async () => {
      return await wageringService.submitTransactionInternal({
        id: randomUUID(),
        ...payloadRefund,
        idempotencyKey: refundIdempotency,
        payloadHash: hashRefund,
        kind: WagerTransactionKind.Refund,
        money: Money.from(payloadRefund.money),
        createdAt: new Date(),
      });
    });

    expect(refundRes.status).toBe(WagerTransactionStatus.PendingReference);
    expect(refundRes.balance.amount).toBe("500.00"); // Saldo inalterado

    // 2. Agora criar a BET referenciada
    const betIdempotency = `bet-${randomUUID()}`;
    const payloadBet = {
      providerId: "provider-test",
      externalTransactionId: betExternalId,
      playerId,
      walletId: wallet.id,
      roundId: "round-2",
      gameId: "slots",
      kind: "BET",
      money: { amount: "50.00", currency: "BRL" },
    };
    const hashBet = wageringService.calculatePayloadHash(payloadBet);

    const betRes = await em.transactional(async () => {
      return await wageringService.submitTransactionInternal({
        id: randomUUID(),
        ...payloadBet,
        idempotencyKey: betIdempotency,
        payloadHash: hashBet,
        kind: WagerTransactionKind.Bet,
        money: Money.from(payloadBet.money),
        createdAt: new Date(),
      });
    });
    expect(betRes.status).toBe(WagerTransactionStatus.Processed);
    expect(betRes.balance.amount).toBe("450.00");

    // 3. Forçar o reprocessamento da referência pendente
    const pendingTx = await em.transactional(async () => {
      return await wagerTxRepo.findByIdempotencyKey(refundIdempotency);
    });
    expect(pendingTx).not.toBeNull();

    await em.transactional(async () => {
      return await wageringService.reprocessPendingReference(pendingTx!.id);
    });

    const finalTx = await em.transactional(async () => {
      return await wagerTxRepo.findByIdempotencyKey(refundIdempotency);
    });
    expect(finalTx!.status).toBe(WagerTransactionStatus.Processed);

    const finalWallet = await em.transactional(async () => {
      return await walletRepo.findById(wallet.id);
    });
    expect(finalWallet!.balance.toJSON().amount).toBe("500.00"); // 500 - 50 (BET) + 50 (REFUND) = 500

  });
});

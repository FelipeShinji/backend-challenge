import { describe, it, beforeAll, afterAll, expect } from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import { AppModule } from "../src/app.module";
import { EntityManager } from "@mikro-orm/postgresql";
import { WalletsService } from "../src/modules/wallets/wallets.service";
import { WageringService } from "../src/modules/wagering/wagering.service";
import { WalletRepository } from "../src/infra/database/repositories/wallet.repository";
import { WagerTransactionRepository } from "../src/infra/database/repositories/wager-transaction.repository";
import { Money } from "../src/domain/money/money";
import { WagerTransactionKind, WagerTransactionStatus } from "../src/domain/wagering/types";
import { randomUUID } from "crypto";

describe("Concurrency Tests", () => {
  let moduleRef: TestingModule;
  let em: EntityManager;
  let walletsService: WalletsService;
  let wageringService: WageringService;
  let walletRepo: WalletRepository;
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
    wagerTxRepo = moduleRef.get(WagerTransactionRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it("cenário obrigatório: saldo inicial 100. Duas apostas de 80 enviadas concorrentemente. Apenas uma passa.", async () => {
    const playerId = randomUUID();
    const wallet = await walletsService.createWallet(playerId, "100.00", "BRL");

    const apostaMoney = Money.from({ amount: "80.00", currency: "BRL" });

    const payload1 = {
      id: randomUUID(),
      providerId: "provider-test",
      externalTransactionId: `bet-${randomUUID()}`,
      idempotencyKey: `key-${randomUUID()}`,
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: apostaMoney,
      createdAt: new Date(),
    };
    const hash1 = wageringService.calculatePayloadHash(payload1);

    const payload2 = {
      id: randomUUID(),
      providerId: "provider-test",
      externalTransactionId: `bet-${randomUUID()}`,
      idempotencyKey: `key-${randomUUID()}`,
      walletId: wallet.id,
      playerId,
      roundId: "round-1",
      gameId: "slots",
      kind: WagerTransactionKind.Bet,
      money: apostaMoney,
      createdAt: new Date(),
    };
    const hash2 = wageringService.calculatePayloadHash(payload2);

    const promises = [
      em.transactional(async () => {
        return await wageringService.submitTransactionInternal({
          ...payload1,
          payloadHash: hash1,
        });
      }),
      em.transactional(async () => {
        return await wageringService.submitTransactionInternal({
          ...payload2,
          payloadHash: hash2,
        });
      }),
    ];

    const results = await Promise.allSettled(promises);

    let processedCount = 0;
    let rejectedCount = 0;

    for (const res of results) {
      if (res.status === "fulfilled") {
        if (res.value.status === WagerTransactionStatus.Processed) {
          processedCount++;
        } else if (res.value.status === WagerTransactionStatus.Rejected) {
          rejectedCount++;
        }
      }
    }

    expect(processedCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const finalWallet = await em.transactional(async () => {
      return await walletRepo.findById(wallet.id);
    });
    expect(finalWallet!.balance.toJSON().amount).toBe("20.00");
  });

  it("50 apostas concorrentes disputando o mesmo saldo -> apenas o saldo disponível é gasto, sem saldo negativo", async () => {
    const playerId = randomUUID();
    const wallet = await walletsService.createWallet(playerId, "100.00", "BRL");

    const apostaMoney = Money.from({ amount: "10.00", currency: "BRL" });
    const count = 50;

    const promises = Array.from({ length: count }).map(async (_, idx) => {
      const payload = {
        id: randomUUID(),
        providerId: "provider-test",
        externalTransactionId: `bet-mult-${idx}-${randomUUID()}`,
        idempotencyKey: `key-mult-${idx}-${randomUUID()}`,
        walletId: wallet.id,
        playerId,
        roundId: "round-mult",
        gameId: "slots",
        kind: WagerTransactionKind.Bet,
        money: apostaMoney,
        createdAt: new Date(),
      };
      const payloadHash = wageringService.calculatePayloadHash(payload);

      try {
        const result = await em.transactional(async () => {
          return await wageringService.submitTransactionInternal({
            ...payload,
            payloadHash,
          });
        });
        return result.status;
      } catch (err) {
        return WagerTransactionStatus.Rejected;
      }
    });

    const results = await Promise.all(promises);

    const processed = results.filter((s) => s === WagerTransactionStatus.Processed).length;
    const rejected = results.filter((s) => s === WagerTransactionStatus.Rejected).length;

    expect(processed).toBe(10);
    expect(rejected).toBe(40);

    const finalWallet = await em.transactional(async () => {
      return await walletRepo.findById(wallet.id);
    });
    expect(finalWallet!.balance.toJSON().amount).toBe("0.00");
  });
});

import { describe, it, expect } from "bun:test";
import { Money } from "../src/domain/money/money";
import {
  WagerTransaction,
  InvalidTransactionStateError,
  MissingReferenceError,
  InvalidTransactionKindError,
} from "../src/domain/wagering/wager-transaction";
import { WagerTransactionKind, WagerTransactionStatus, LedgerDirection } from "../src/domain/wagering/types";

function criarBet(overrides: Partial<Parameters<typeof WagerTransaction.create>[0]> = {}) {
  return WagerTransaction.create({
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-1",
    idempotencyKey: "provider-a:ext-1",
    payloadHash: "hash-abc",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "fortune-chimp",
    kind: WagerTransactionKind.Bet,
    money: Money.from({ amount: "25.00", currency: "BRL" }),
    createdAt: new Date(),
    ...overrides,
  });
}

describe("WagerTransaction", () => {
  it("nasce em PENDING", () => {
    const tx = criarBet();
    expect(tx.status).toBe(WagerTransactionStatus.Pending);
    expect(tx.isTerminal()).toBe(false);
  });

  it("rejeita criação direta de OPENING (é interno)", () => {
    expect(() =>
      criarBet({ kind: WagerTransactionKind.Opening }),
    ).toThrow(InvalidTransactionKindError);
  });

  it("exige referenceExternalTransactionId para REFUND", () => {
    expect(() =>
      criarBet({ kind: WagerTransactionKind.Refund, referenceExternalTransactionId: undefined }),
    ).toThrow(MissingReferenceError);
  });

  it("aceita REFUND com referência presente", () => {
    const tx = criarBet({
      kind: WagerTransactionKind.Refund,
      referenceExternalTransactionId: "ext-original-bet",
    });
    expect(tx.requiresReference()).toBe(true);
  });

  it("markProcessed move para PROCESSED e marca processedAt", () => {
    const tx = criarBet();
    const agora = new Date();
    tx.markProcessed(undefined, agora);
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.processedAt).toBe(agora);
    expect(tx.isTerminal()).toBe(true);
  });

  it("reject move para REJECTED com failureCode", () => {
    const tx = criarBet();
    tx.reject("INSUFFICIENT_BALANCE");
    expect(tx.status).toBe(WagerTransactionStatus.Rejected);
    expect(tx.failureCode).toBe("INSUFFICIENT_BALANCE");
    expect(tx.isTerminal()).toBe(true);
  });

  it("markPendingReference move para PENDING_REFERENCE (não terminal)", () => {
    const tx = criarBet();
    tx.markPendingReference();
    expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
    expect(tx.isTerminal()).toBe(false);
  });

  it("estado terminal não pode transicionar de novo", () => {
    const tx = criarBet();
    tx.markProcessed(undefined, new Date());
    expect(() => tx.reject("INSUFFICIENT_BALANCE")).toThrow(
      InvalidTransactionStateError,
    );
    expect(() => tx.markProcessed(undefined, new Date())).toThrow(
      InvalidTransactionStateError,
    );
  });

  it("LOSS não afeta saldo, BET afeta", () => {
    const bet = criarBet({ kind: WagerTransactionKind.Bet });
    const loss = criarBet({ kind: WagerTransactionKind.Loss });
    expect(bet.affectsBalance()).toBe(true);
    expect(loss.affectsBalance()).toBe(false);
  });

  it("matchesPayload compara o hash corretamente", () => {
    const tx = criarBet({ payloadHash: "hash-xyz" });
    expect(tx.matchesPayload("hash-xyz")).toBe(true);
    expect(tx.matchesPayload("hash-outro")).toBe(false);
  });

  it("ledgerDirectionFor: BET é débito, WIN é crédito", () => {
    const bet = criarBet({ kind: WagerTransactionKind.Bet });
    const win = criarBet({ kind: WagerTransactionKind.Win });
    expect(bet.ledgerDirectionFor()).toBe(LedgerDirection.Debit);
    expect(win.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  it("ledgerDirectionFor: ROLLBACK inverte a direção da referência", () => {
    const betOriginal = criarBet({ kind: WagerTransactionKind.Bet }); // débito
    const rollback = criarBet({
      kind: WagerTransactionKind.Rollback,
      referenceExternalTransactionId: "ext-1",
    });
    // BET foi débito, então o rollback do BET deve ser crédito (devolve o dinheiro)
    expect(rollback.ledgerDirectionFor(betOriginal)).toBe(LedgerDirection.Credit);
  });

  it("rehydrate reconstrói sem revalidar", () => {
    const original = criarBet();
    original.reject("INSUFFICIENT_BALANCE");

    const reidratada = WagerTransaction.rehydrate({
      id: original.id,
      providerId: original.providerId,
      externalTransactionId: original.externalTransactionId,
      idempotencyKey: original.idempotencyKey,
      payloadHash: original.payloadHash,
      walletId: original.walletId,
      playerId: original.playerId,
      roundId: original.roundId,
      gameId: original.gameId,
      kind: original.kind,
      money: original.money.toJSON(),
      referenceExternalTransactionId: original.referenceExternalTransactionId,
      createdAt: original.createdAt,
      status: original.status,
      referenceTransactionId: original.referenceTransactionId,
      failureCode: original.failureCode,
      processedAt: original.processedAt,
    });

    expect(reidratada.status).toBe(WagerTransactionStatus.Rejected);
    expect(reidratada.failureCode).toBe("INSUFFICIENT_BALANCE");
  });
});

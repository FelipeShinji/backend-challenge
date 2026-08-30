import { describe, it, expect } from "bun:test";
import { Money } from "../src/domain/money/money";
import { WalletLedgerEntry } from "../src/domain/wallet/wallet-ledger-entry";
import { LedgerDirection } from "../src/domain/wagering/types";

describe("WalletLedgerEntry", () => {
  it("cria um lançamento de CREDIT balanceado", () => {
    const entry = WalletLedgerEntry.create({
      id: "entry-1",
      walletId: "wallet-1",
      transactionId: "tx-1",
      direction: LedgerDirection.Credit,
      money: Money.from({ amount: "50.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "150.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it("cria um lançamento de DEBIT balanceado", () => {
    const entry = WalletLedgerEntry.create({
      id: "entry-2",
      walletId: "wallet-1",
      transactionId: "tx-2",
      direction: LedgerDirection.Debit,
      money: Money.from({ amount: "30.00", currency: "BRL" }),
      balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
      balanceAfter: Money.from({ amount: "70.00", currency: "BRL" }),
    });

    expect(entry.isBalanced()).toBe(true);
  });

  it("rejeita criação de lançamento CREDIT desbalanceado", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-3",
        walletId: "wallet-1",
        transactionId: "tx-3",
        direction: LedgerDirection.Credit,
        money: Money.from({ amount: "50.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        // deveria ser 150.00 — valor errado de propósito
        balanceAfter: Money.from({ amount: "140.00", currency: "BRL" }),
      }),
    ).toThrow(/desbalanceado/);
  });

  it("rejeita criação de lançamento DEBIT desbalanceado", () => {
    expect(() =>
      WalletLedgerEntry.create({
        id: "entry-4",
        walletId: "wallet-1",
        transactionId: "tx-4",
        direction: LedgerDirection.Debit,
        money: Money.from({ amount: "30.00", currency: "BRL" }),
        balanceBefore: Money.from({ amount: "100.00", currency: "BRL" }),
        // deveria ser 70.00 — valor errado de propósito
        balanceAfter: Money.from({ amount: "80.00", currency: "BRL" }),
      }),
    ).toThrow(/desbalanceado/);
  });

  it("rehydrate reconstrói sem revalidar a aritmética", () => {
    // Mesmo com valores propositalmente inconsistentes, rehydrate não lança
    // erro — ele confia que o banco já validou isso na criação original.
    const entry = WalletLedgerEntry.rehydrate({
      id: "entry-6",
      walletId: "wallet-1",
      transactionId: "tx-6",
      direction: LedgerDirection.Credit,
      money: { amount: "10.00", currency: "BRL" },
      balanceBefore: { amount: "0.00", currency: "BRL" },
      balanceAfter: { amount: "999.00", currency: "BRL" }, // inconsistente de propósito
      createdAt: new Date(),
    });

    expect(entry.balanceAfter.toJSON().amount).toBe("999.00");
  });

  it("isBalanced retorna false para um estado reidratado inconsistente", () => {
    const entry = WalletLedgerEntry.rehydrate({
      id: "entry-7",
      walletId: "wallet-1",
      transactionId: "tx-7",
      direction: LedgerDirection.Credit,
      money: { amount: "10.00", currency: "BRL" },
      balanceBefore: { amount: "0.00", currency: "BRL" },
      balanceAfter: { amount: "999.00", currency: "BRL" },
      createdAt: new Date(),
    });

    expect(entry.isBalanced()).toBe(false);
  });
});

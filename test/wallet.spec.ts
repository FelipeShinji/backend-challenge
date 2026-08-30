import { describe, it, expect } from "bun:test";
import { Money } from "../src/domain/money/money";
import {
  Wallet,
  InsufficientBalanceError,
  WalletCurrencyMismatchError,
} from "../src/domain/wallet/wallet";

function criarWallet(saldoInicial = "100.00") {
  return Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: Money.from({ amount: saldoInicial, currency: "BRL" }),
  });
}

describe("Wallet", () => {
  it("abre uma wallet com saldo inicial e version 1", () => {
    const wallet = criarWallet("100.00");
    expect(wallet.balance.toJSON()).toEqual({ amount: "100.00", currency: "BRL" });
    expect(wallet.version).toBe(1);
  });

  it("debita um valor e reduz o saldo", () => {
    const wallet = criarWallet("100.00");
    wallet.debit(Money.from({ amount: "30.00", currency: "BRL" }));
    expect(wallet.balance.toJSON().amount).toBe("70.00");
  });

  it("incrementa version a cada mudança de saldo", () => {
    const wallet = criarWallet("100.00");
    expect(wallet.version).toBe(1);
    wallet.debit(Money.from({ amount: "10.00", currency: "BRL" }));
    expect(wallet.version).toBe(2);
    wallet.credit(Money.from({ amount: "5.00", currency: "BRL" }));
    expect(wallet.version).toBe(3);
  });

  it("credita um valor e aumenta o saldo", () => {
    const wallet = criarWallet("100.00");
    wallet.credit(Money.from({ amount: "50.00", currency: "BRL" }));
    expect(wallet.balance.toJSON().amount).toBe("150.00");
  });

  it("rejeita débito que deixaria o saldo negativo", () => {
    const wallet = criarWallet("100.00");
    expect(() =>
      wallet.debit(Money.from({ amount: "150.00", currency: "BRL" })),
    ).toThrow(InsufficientBalanceError);
    // saldo não deve ter mudado após a tentativa rejeitada
    expect(wallet.balance.toJSON().amount).toBe("100.00");
  });

  it("permite debitar o saldo total, deixando zero", () => {
    const wallet = criarWallet("100.00");
    wallet.debit(Money.from({ amount: "100.00", currency: "BRL" }));
    expect(wallet.balance.isZero()).toBe(true);
  });

  it("rejeita operação com moeda diferente da wallet", () => {
    const wallet = criarWallet("100.00");
    expect(() =>
      wallet.debit(Money.from({ amount: "10.00", currency: "USD" })),
    ).toThrow(WalletCurrencyMismatchError);
  });

  it("cenário obrigatório: duas apostas de 80 sobre saldo de 100 — só uma pode passar", () => {
    // Este teste é sequencial (não concorrente de verdade) — serve para
    // validar a REGRA de negócio. O teste de concorrência real com múltiplas
    // instâncias/threads fica para a suíte de integração (usa o banco).
    const wallet = criarWallet("100.00");
    const aposta = Money.from({ amount: "80.00", currency: "BRL" });

    wallet.debit(aposta); // primeira passa
    expect(wallet.balance.toJSON().amount).toBe("20.00");

    expect(() => wallet.debit(aposta)).toThrow(InsufficientBalanceError); // segunda rejeitada
    expect(wallet.balance.toJSON().amount).toBe("20.00"); // saldo final correto
  });

  it("rehydrate reconstrói o estado sem revalidar", () => {
    const original = criarWallet("100.00");
    original.debit(Money.from({ amount: "30.00", currency: "BRL" }));

    const reidratada = Wallet.rehydrate({
      id: original.id,
      playerId: original.playerId,
      currency: original.currency,
      balance: original.balance.toJSON(),
      version: original.version,
      createdAt: original.createdAt,
      updatedAt: original.updatedAt,
    });

    expect(reidratada.balance.toJSON()).toEqual(original.balance.toJSON());
    expect(reidratada.version).toBe(original.version);
  });
});

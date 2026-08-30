import { describe, it, expect } from "bun:test";
import { Money, InvalidMoneyError, CurrencyMismatchError } from "../src/domain/money/money";

describe("Money", () => {
  it("cria um Money válido a partir de string decimal", () => {
    const money = Money.from({ amount: "25.00", currency: "BRL" });
    expect(money.toJSON()).toEqual({ amount: "25.00", currency: "BRL" });
  });

  it("soma dois valores da mesma moeda", () => {
    const a = Money.from({ amount: "10.50", currency: "BRL" });
    const b = Money.from({ amount: "5.25", currency: "BRL" });
    expect(a.add(b).toJSON().amount).toBe("15.75");
  });

  it("subtrai dois valores da mesma moeda", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "3.00", currency: "BRL" });
    expect(a.subtract(b).toJSON().amount).toBe("7.00");
  });

  it("lança erro ao operar com moedas diferentes", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "USD" });
    expect(() => a.add(b)).toThrow(CurrencyMismatchError);
  });

  it("rejeita valores negativos na entrada", () => {
    expect(() => Money.from({ amount: "-5.00", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita mais de 2 casas decimais", () => {
    expect(() => Money.from({ amount: "5.999", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita notação científica", () => {
    expect(() => Money.from({ amount: "1e10", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita NaN e Infinity como string", () => {
    expect(() => Money.from({ amount: "NaN", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
    expect(() => Money.from({ amount: "Infinity", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("rejeita string vazia", () => {
    expect(() => Money.from({ amount: "", currency: "BRL" })).toThrow(
      InvalidMoneyError,
    );
  });

  it("Money é imutável — operações retornam nova instância", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = a.add(Money.from({ amount: "5.00", currency: "BRL" }));
    expect(a.toJSON().amount).toBe("10.00"); // "a" não mudou
    expect(b.toJSON().amount).toBe("15.00");
  });

  it("compara igualdade corretamente", () => {
    const a = Money.from({ amount: "10.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });
    expect(a.equals(b)).toBe(true);
  });

  it("isLessThan compara corretamente", () => {
    const a = Money.from({ amount: "5.00", currency: "BRL" });
    const b = Money.from({ amount: "10.00", currency: "BRL" });
    expect(a.isLessThan(b)).toBe(true);
    expect(b.isLessThan(a)).toBe(false);
  });
});

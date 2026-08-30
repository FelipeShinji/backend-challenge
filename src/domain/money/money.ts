import Decimal from "decimal.js";

export interface MoneyProps {
  amount: string; // decimal string, ex.: "25.00"
  currency: string; // ISO-4217, ex.: "BRL"
}

/**
 * Value Object monetário.
 *
 * Por que Decimal e não number:
 * `number` em JS é float de 64 bits (IEEE 754) — operações como
 * 0.1 + 0.2 não dão exatamente 0.3. Em dinheiro, esse tipo de erro
 * de arredondamento é inaceitável (é literalmente dinheiro sumindo
 * ou aparecendo do nada). Por isso usamos uma lib de precisão
 * arbitrária (decimal.js) e persistimos/serializamos como string.
 */
export class Money {
  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  static from(props: MoneyProps): Money {
    this.assertValidAmountString(props.amount);
    this.assertValidCurrency(props.currency);

    const value = new Decimal(props.amount).toDecimalPlaces(2);
    return new Money(value, props.currency.toUpperCase());
  }

  static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency });
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.greaterThan(0);
  }

  isNegative(): boolean {
    return this.value.lessThan(0);
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.value.toFixed(2),
      currency: this.currency,
    };
  }

  toString(): string {
    return `${this.value.toFixed(2)} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }

  // ---- validação de entrada (nível de contrato/API) ----

  private static assertValidAmountString(amount: string): void {
    if (typeof amount !== "string" || amount.trim() === "") {
      throw new InvalidMoneyError("amount não pode ser vazio");
    }

    // Rejeita notação científica, NaN, Infinity, espaços, etc.
    // Aceita apenas dígitos, opcionalmente um ponto decimal com até 2 casas.
    const validFormat = /^\d+(\.\d{1,2})?$/;
    if (!validFormat.test(amount.trim())) {
      throw new InvalidMoneyError(
        `amount inválido: "${amount}" (use string decimal com até 2 casas, ex: "25.00")`,
      );
    }

    const decimal = new Decimal(amount);
    if (decimal.isNegative()) {
      throw new InvalidMoneyError("amount não pode ser negativo em contratos de entrada");
    }
  }

  private static assertValidCurrency(currency: string): void {
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
      throw new InvalidMoneyError(
        `currency inválida: "${currency}" (esperado código ISO-4217 de 3 letras)`,
      );
    }
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMoneyError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Operação entre moedas diferentes: ${a} vs ${b}`);
    this.name = "CurrencyMismatchError";
  }
}

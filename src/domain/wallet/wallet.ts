import { Money, MoneyProps } from "../money/money";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: MoneyProps;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

/**
 * Wallet é o Aggregate Root: TODA alteração de saldo passa por aqui.
 * Isso garante que a invariante "saldo nunca negativo" nunca é
 * violada, não importa de onde a chamada venha.
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static open(props: OpenWalletProps): Wallet {
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1, // version começa em 1 após a criação, conforme especificação
      now,
      now,
    );
  }

  /**
   * Reconstrução a partir da persistência.
   * NÃO revalida regras de transição — o banco já garantiu a
   * consistência quando os dados foram salvos.
   */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      Money.from(state.balance),
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debita um valor do saldo. Lança erro se o saldo ficaria negativo.
   * version só incrementa quando o saldo de fato muda.
   */
  debit(money: Money): void {
    this.assertSameCurrency(money);

    if (this._balance.isLessThan(money)) {
      throw new InsufficientBalanceError(this.id, this._balance, money);
    }

    this._balance = this._balance.subtract(money);
    this.touch();
  }

  /**
   * Credita um valor no saldo.
   */
  credit(money: Money): void {
    this.assertSameCurrency(money);

    this._balance = this._balance.add(money);
    this.touch();
  }

  private touch(): void {
    this._version += 1;
    this._updatedAt = new Date();
  }

  private assertSameCurrency(money: Money): void {
    if (money.currency !== this.currency) {
      throw new WalletCurrencyMismatchError(this.currency, money.currency);
    }
  }
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly walletId: string,
    public readonly currentBalance: Money,
    public readonly requestedAmount: Money,
  ) {
    super(
      `Saldo insuficiente na wallet ${walletId}: saldo atual ${currentBalance.toString()}, tentativa de débito ${requestedAmount.toString()}`,
    );
    this.name = "InsufficientBalanceError";
  }
}

export class WalletCurrencyMismatchError extends Error {
  constructor(walletCurrency: string, operationCurrency: string) {
    super(
      `Moeda da operação (${operationCurrency}) diferente da moeda da wallet (${walletCurrency})`,
    );
    this.name = "WalletCurrencyMismatchError";
  }
}

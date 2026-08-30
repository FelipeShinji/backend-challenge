import { AsyncLocalStorage } from "async_hooks";

export interface LogStore {
  correlationId?: string;
  messageId?: string;
  transactionId?: string;
  walletId?: string;
  providerId?: string;
}

export class LoggerContext {
  private static readonly storage = new AsyncLocalStorage<LogStore>();

  static run<T>(store: LogStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static getStore(): LogStore | undefined {
    return this.storage.getStore();
  }

  static update(update: Partial<LogStore>): void {
    const store = this.getStore();
    if (store) {
      Object.assign(store, update);
    }
  }
}

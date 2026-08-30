export enum WagerTransactionKind {
  Opening = "OPENING", // interno: crédito de abertura da wallet — nunca vem da API/fila
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING", // aceita, ainda não aplicada
  PendingReference = "PENDING_REFERENCE", // aguardando a transação referenciada
  Processed = "PROCESSED", // aplicada (terminal)
  Rejected = "REJECTED", // violação de regra de negócio (terminal)
  Failed = "FAILED", // erro permanente de infraestrutura (terminal, auditável)
}

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

/**
 * Taxonomia de códigos de falha — estável e legível por máquina, para o
 * provedor decidir se reenvia, corrige o payload ou desiste.
 * Lista inicial; estenda conforme novos casos de rejeição aparecerem.
 */
export type FailureCode =
  | "INSUFFICIENT_BALANCE" // aposta sem saldo suficiente
  | "REVERSAL_WOULD_GO_NEGATIVE" // reversão que deixaria saldo negativo — diferente de saldo insuficiente numa aposta
  | "REFERENCE_NOT_FOUND" // referência esgotou tentativas e nunca apareceu
  | "REFERENCE_ALREADY_REVERSED" // já existe REFUND/ROLLBACK para essa referência
  | "REFERENCE_WRONG_KIND" // ex.: REFUND apontando para algo que não é BET
  | "CURRENCY_MISMATCH"
  | "IDEMPOTENCY_PAYLOAD_CONFLICT" // mesma key, payload diferente
  | "INFRASTRUCTURE_ERROR"; // usado com fail(), não reject()

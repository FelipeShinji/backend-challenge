# Wagering Processor — Distributed Financial Service

Este é o serviço financeiro distribuído de processamento de apostas da Jungle Gaming. A aplicação foi construída utilizando TypeScript estrito, NestJS, Bun, PostgreSQL (MikroORM) e AWS SQS (LocalStack).

## 🚀 Como Rodar o Projeto

### Pré-requisitos
- Docker e Docker Compose instalados.
- [Bun](https://bun.sh) runtime (v1.x) instalado localmente.

### Passos para inicializar

1. **Subir os containers do banco de dados (PostgreSQL) e mensageria (LocalStack/SQS):**
   ```bash
   docker compose up -d
   ```

2. **Criar as filas FIFO no LocalStack:**
   ```bash
   sh scripts/setup-queues.sh
   ```

3. **Instalar as dependências:**
   ```bash
   bun install
   ```

4. **Rodar as migrações (se for executar em dev manual):**
   O aplicativo executa as migrações automaticamente ao iniciar, mas você também pode rodá-las ou criá-las via CLI do MikroORM, se preferir.

5. **Iniciar a aplicação em modo desenvolvimento:**
   ```bash
   bun start:dev
   ```

---

## 🧪 Rodar os Testes

O projeto vem com uma suíte de testes completa cobrindo regras de negócio (Money, Wallet, WagerTransaction), integração transacional (Outbox/Inbox) e simulação de concorrência real.

### Rodar todos os testes
```bash
bun test
```

A suíte inclui:
- `test/money.spec.ts`: Testes unitários do Value Object monetário.
- `test/wallet.spec.ts`: Testes unitários das invariantes de Wallet.
- `test/wager-transaction.spec.ts`: Testes unitários das transições e invariantes da máquina de estado de transações.
- `test/integration.spec.ts`: Testes de integração (fluxo completo de BET, WIN, REFUND, idempotência, e processamento de referências fora de ordem).
- `test/concurrency.spec.ts`: Testes de concorrência (cenário de concorrência de 80.00 sobre saldo de 100.00 simultâneos, e 50 apostas simultâneas disputando o mesmo saldo com locks pessimistas).

---

## 🏛️ Estrutura do Projeto

```
src/
  domain/                 -> Regras puras, sem frameworks/decorators
    money/
      money.ts
    wallet/
      wallet.ts           -> Aggregate Root
      wallet-ledger-entry.ts
    wagering/
      wager-transaction.ts
      types.ts            -> Enums e FailureCodes
    messaging/
      inbox.ts            -> Inbox de deduplicação
      outbox.ts           -> Outbox de publicação confiável
      events.ts           -> Eventos de Integração

  infra/                  -> Detalhes de implementação
    database/
      entities/           -> Mapeamentos MikroORM
      repositories/       -> Repositórios que retornam objetos de domínio
      migrations/         -> Migrações SQL versionadas
      mikro-orm.config.ts -> Configuração do MikroORM
    messaging/
      sqs-client.ts       -> Integração AWS SDK SQS
      outbox.worker.ts    -> Worker da Outbox (SKIP LOCKED)
      sqs-consumer.ts     -> Consumidor SQS FIFO com Inbox
      pending-reference.worker.ts -> Reprocessamento de wagers pendentes

  modules/                -> Controladores NestJS
    wallets/              -> Criação, ledger paginado e reconciliação
    wagering/             -> Envio e consulta de transações HTTP
    auth/                 -> Extension point de autenticação
    health/               -> Liveness/Readiness probes

test/                     -> Testes de unidade, integração e concorrência
```

---

## 🔗 Endpoints HTTP Expostos

### Wallets
- **POST `/wallets`**: Cria uma nova carteira para o jogador. Permite saldo inicial (que gera transação interna `OPENING` e registro de ledger `CREDIT`).
- **GET `/wallets/:walletId`**: Obtém o saldo e versão atual.
- **GET `/wallets/:walletId/ledger`**: Retorna os lançamentos contábeis paginados por cursor (`limit` default é 50).
- **POST `/wallets/:walletId/reconciliation`**: Roda o auditor interno comparando saldo materializado com a somatória do ledger.

### Wagering
- **POST `/wagering/transactions`**: Submete uma nova transação financeira. Exige cabeçalho `Idempotency-Key` e `X-Provider-Id` (para auth).
- **GET `/wagering/transactions/:transactionId`**: Consulta transação por ID interno.
- **GET `/providers/:providerId/wagering/transactions/:externalTransactionId`**: Consulta transação pelo ID externo do provedor.

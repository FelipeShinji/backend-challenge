# Decisões de Arquitetura — Distributed Wagering Processor

Este documento detalha o desenho arquitetural, escolhas tecnológicas e trade-offs adotados na solução do desafio.

## 1. Domain-Driven Design (DDD) & Domínio Puro
Em conformidade com as diretrizes do desafio, a camada de domínio (`src/domain/`) é totalmente isolada e escrita em TypeScript estrito e puro:
- **Sem Frameworks ou Decorators**: Não há imports do NestJS, MikroORM ou decorators como `@Entity()` ou `@Column()`. Isso evita acoplamento técnico com a infraestrutura, facilitando testes de unidade purificados e evolução do código.
- **Value Objects Imutáveis (`Money`)**: Encapsula regras financeiras (ISO-4217, escala de 2 casas, validação de NaN, notação científica, etc.) usando a biblioteca `decimal.js` para precisão decimal exata. Toda modificação gera uma nova instância de `Money`.
- **Aggregate Root (`Wallet`)**: Responsável por garantir que a invariante do saldo nunca negativo e a moeda sejam respeitadas.
- **Data Mappers (`*Mapper`)**: A ponte de persistência é realizada por Mappers na infraestrutura (`src/infra/database/entities/`), convertendo entidades do banco para modelos ricos de domínio na reidratação, e vice-versa no salvamento.

---

## 2. Estratégia Transacional e de Concorrência
O sistema deve lidar perfeitamente com condições de corrida e alta concorrência sobre a mesma wallet (Hot Wallet).
- **Pessimistic Row-Level Locking (Escolha principal)**:
  - Optou-se por aplicar bloqueio pessimista de escrita (`SELECT ... FOR UPDATE` via `LockMode.PESSIMISTIC_WRITE` no MikroORM) ao obter a wallet correspondente a uma operação financeira concorrente.
  - **Justificativa**: Em cenários com dezenas de transações simultâneas para a mesma wallet (ex.: 50 apostas paralelas de 10.00 disputando saldo), o optimistic locking baseado em `version` causaria sucessivas falhas de versão e forçaria loops de retentativa complexos e pesados no banco. O bloqueio pessimista serializa as transações a nível de linha no PostgreSQL, resultando em concorrência ordenada, previsível e sem falhas de transação ou concorrência global (wallets distintas processam-se em paralelo).
- **Atomicidade Transacional**:
  - Todo o processamento de aposta (débito/crédito, inserção de ledger, deduplicação de idempotência/inbox e enfileiramento na outbox) participa da mesma transação de banco de dados (`em.transactional`). Ou tudo é persistido com sucesso e commitado, ou nada é.

---

## 3. Idempotência Persistente e Deduplicação (Inbox & Outbox)
- **Garantia Exactly-Once com Inbox**:
  - Mensagens recebidas do SQS são rastreadas de forma persistente através da tabela `inbox_messages` (chave composta por `consumerName` e `messageId`).
  - O registro na inbox é inserido e marcado como processado no mesmo escopo transacional das alterações financeiras, garantindo idempotência e prevenindo que redeliveries do SQS apliquem efeitos duplicados.
- **Publicação Resiliente com Outbox**:
  - Eventos de integração gerados são persistidos como `outbox_messages` na mesma transação.
  - O `OutboxWorker` pesquisa mensagens pendentes usando `SKIP LOCKED` para suportar múltiplas instâncias concorrentes de worker sem colidir nem publicar eventos duplicados. Uma vez publicado com sucesso no SQS, o status é atualizado para publicado. Caso falhe, é feito um agendamento com backoff exponencial.

---

## 4. Referências Fora de Ordem e Processamento Pendente
- Se um `REFUND` ou `ROLLBACK` chegar antes do `BET` correspondente ser processado, a transação é guardada no estado `PENDING_REFERENCE`.
- O `PendingReferenceWorker` consome transações nesse estado e tenta reprocessá-las com backoff exponencial.
- **TTL & Timeout**: Definimos um TTL de 5 minutos e limite máximo de 5 tentativas. Esgotados os limites, o status transiciona para o estado terminal `REJECTED` com o failureCode `REFERENCE_NOT_FOUND` e o evento correspondente é emitido via outbox.

---

## 5. Autenticação e Provedores (Section 2)
- Conforme permitido, a autenticação foi modelada via `AuthGuard` de no-op integrado como ponto de extensão.
- Ele extrai o cabeçalho `X-Provider-Id` e popula o contexto de requisição. Em um cenário real de produção, esse Guard realizaria a verificação de assinatura JWT vinda de um servidor OIDC (como Keycloak ou Zitadel).

---

## 6. Auditoria e Reconciliação
- O endpoint `/wallets/:walletId/reconciliation` calcula o saldo com base no histórico contábil (`calculatedBalance` através de somatório SQL de `CREDIT` menos `DEBIT`) e o compara com o saldo atual gravado (`storedBalance`).
- Qualquer inconsistência é sinalizada com `consistent: false`, acompanhada da diferença contábil e logada com aviso prioritário para monitoramento.

## 7. Observabilidade
- **Logs Estruturados (JSON)**: Implementamos um `JsonLoggerService` que substitui o logger padrão do NestJS. Ele se integra ao `AsyncLocalStorage` para capturar e enriquecer automaticamente os logs com chaves contextuais (`correlationId`, `messageId`, `transactionId`, `walletId`, `providerId`) sem a necessidade de passar parâmetros extras manualmente nas chamadas de log.
- **Métricas Prometheus**: Desenvolvemos um coletor de métricas nativo em memória (`MetricsService`) que expõe um endpoint `GET /metrics` no formato padrão de exposição do Prometheus. Ele coleta e expõe todas as métricas obrigatórias da Seção 12 (transações por status/tipo, duplicatas, retentativas, DLQ, conflitos de lock, outbox lag e latência), mantendo a stack de execução leve e sem dependências externas.

---

## 8. Limitações Conhecidas e Trabalho Futuro

- **Escopo do teste de concorrência (`test/concurrency.spec.ts`)**: os testes
  disparam transações SQL genuinamente concorrentes contra o PostgreSQL real
  (via `Promise.all`/`Promise.allSettled` sobre múltiplas chamadas
  `em.transactional`), o que valida corretamente o comportamento do lock
  pessimista a nível de linha sob concorrência real de banco de dados. No
  entanto, todas as chamadas partem de um único processo Bun, não de
  múltiplos processos/instâncias da aplicação isoladas como sugerido na
  seção 13 do desafio. Optamos por essa abordagem por ser mais simples de
  automatizar em CI; o mesmo mecanismo de lock (`PESSIMISTIC_WRITE` a nível
  de linha no PostgreSQL) se aplica igualmente bem a múltiplas instâncias
  reais, já que a garantia de exclusão mútua vem do banco, não do processo
  Node/Bun. Um teste complementar com múltiplos processos filhos (via
  `child_process` ou contêineres separados) seria o próximo passo natural
  para validar isso de forma ainda mais fiel ao cenário de produção.


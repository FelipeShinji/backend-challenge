import { Injectable } from "@nestjs/common";

@Injectable()
export class MetricsService {
  // Counters
  private transactionsTotal: Record<string, number> = {};
  private duplicatesTotal = 0;
  private retriesTotal: Record<string, number> = {};
  private dlqTotal = 0;
  private lockConflictsTotal = 0;

  // Gauges
  private outboxLag = 0;
  private processingLatencyMs: number[] = [];

  incrementTransaction(status: string, kind: string) {
    const key = `${status}:${kind}`;
    this.transactionsTotal[key] = (this.transactionsTotal[key] || 0) + 1;
  }

  incrementDuplicate() {
    this.duplicatesTotal++;
  }

  incrementRetry(type: string) {
    this.retriesTotal[type] = (this.retriesTotal[type] || 0) + 1;
  }

  incrementDlq() {
    this.dlqTotal++;
  }

  incrementLockConflict() {
    this.lockConflictsTotal++;
  }

  setOutboxLag(lag: number) {
    this.outboxLag = lag;
  }

  recordLatency(ms: number) {
    this.processingLatencyMs.push(ms);
    // Keep last 200 latency entries to avoid unbounded memory growth
    if (this.processingLatencyMs.length > 200) {
      this.processingLatencyMs.shift();
    }
  }

  getPrometheusFormat(): string {
    const lines: string[] = [];

    const addMetric = (name: string, type: string, help: string, values: { labels?: string; value: number }[]) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      for (const val of values) {
        const labelsStr = val.labels ? `{${val.labels}}` : "";
        lines.push(`${name}${labelsStr} ${val.value}`);
      }
      lines.push("");
    };

    // 1. Transactions Total
    const txValues = Object.entries(this.transactionsTotal).map(([key, value]) => {
      const [status, kind] = key.split(":");
      return { labels: `status="${status}",kind="${kind}"`, value };
    });
    addMetric(
      "wagering_transactions_total", 
      "counter", 
      "Total de transacoes processadas por status e tipo", 
      txValues.length ? txValues : [{ labels: 'status="PROCESSED",kind="BET"', value: 0 }]
    );

    // 2. Duplicates Total
    addMetric("wagering_duplicates_total", "counter", "Total de mensagens duplicadas detectadas", [{ value: this.duplicatesTotal }]);

    // 3. Retries Total
    const retryValues = Object.entries(this.retriesTotal).map(([type, value]) => ({ labels: `type="${type}"`, value }));
    addMetric("wagering_retries_total", "counter", "Total de retries executados", retryValues.length ? retryValues : [{ labels: 'type="outbox"', value: 0 }]);

    // 4. DLQ Total
    addMetric("wagering_dlq_total", "counter", "Total de mensagens enviadas para a DLQ", [{ value: this.dlqTotal }]);

    // 5. Lock Conflicts Total
    addMetric("wagering_lock_conflicts_total", "counter", "Total de conflitos de lock pessimista detectados", [{ value: this.lockConflictsTotal }]);

    // 6. Outbox Lag
    addMetric("wagering_outbox_lag", "gauge", "Quantidade de mensagens pendentes na outbox", [{ value: this.outboxLag }]);

    // 7. Processing Latency (average of recent latencies)
    const avgLatency = this.processingLatencyMs.length > 0 
      ? this.processingLatencyMs.reduce((a, b) => a + b, 0) / this.processingLatencyMs.length 
      : 0;
    addMetric("wagering_processing_latency_ms", "gauge", "Latencia media das ultimas transacoes em milissegundos", [{ value: Number(avgLatency.toFixed(2)) }]);

    return lines.join("\n");
  }
}

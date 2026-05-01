// Circuit breaker — sentinel-file based.
//
// Spec: docs/poc-spec.md §"Politeness budget" + §"Failure handling".
//   3 consecutive 4xx (excluding 404) → 24h pause.
//   Manual clear by deleting `data/.circuit_open`.

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

export interface CircuitConfig {
  sentinelPath: string;
  threshold: number;
  pauseDurationMs: number;
}

export class Circuit {
  // Process-local on purpose — only counts failures inside the current sweep.
  // The sentinel file is what carries state across cron ticks.
  private failureCount = 0;

  constructor(private readonly config: CircuitConfig) {}

  async isOpen(): Promise<boolean> {
    try {
      const info = await fs.stat(this.config.sentinelPath);
      return Date.now() - info.mtimeMs < this.config.pauseDurationMs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async recordFailure(): Promise<void> {
    this.failureCount += 1;
    if (this.failureCount >= this.config.threshold) {
      await this.openSentinel();
    }
  }

  // Opens the breaker on the very first hit. Use for unambiguous block signals
  // (403/429) where retrying again would risk an IP-level block.
  async tripImmediately(): Promise<void> {
    await this.openSentinel();
  }

  recordSuccess(): void {
    this.failureCount = 0;
  }

  private async openSentinel(): Promise<void> {
    await fs.mkdir(dirname(this.config.sentinelPath), { recursive: true });
    await fs.writeFile(this.config.sentinelPath, '');
  }
}

// In-process EventEmitter for sweep lifecycle events.
// The crawler emits SweepEvent objects on this; SSE route subscribes per-sweep.
//
// TODO (Claude Code, Task 2): wire src/log.ts pino transport to call
// sweepEvents.emit('event', {...}) for every log line during a sweep, with
// the active sweep id attached.

import { EventEmitter } from 'node:events';

export interface SweepEvent {
  sweepId: string;
  t: string; // 'HH:MM:SS' for UI alignment with logTail
  lvl: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: string;
}

class TypedEmitter extends EventEmitter {
  emitEvent(ev: SweepEvent): void {
    this.emit('event', ev);
  }
  onEvent(fn: (ev: SweepEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const sweepEvents = new TypedEmitter();
sweepEvents.setMaxListeners(50); // many concurrent SSE clients are fine

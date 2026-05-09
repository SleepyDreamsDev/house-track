// DB-to-UI status translation.
//
// The crawler writes a granular status string ('in_progress', 'ok', 'partial',
// 'failed', 'circuit_open', 'cancelled'). The operator UI distinguishes four
// states so an intentional cancel doesn't look like a real failure. partial,
// failed, and circuit_open all collapse to 'failed' — the operator can drill
// into the sweep's errors[] for detail.
export type UiSweepStatus = 'running' | 'success' | 'failed' | 'cancelled';

export function toUiStatus(dbStatus: string): UiSweepStatus {
  if (dbStatus === 'in_progress') return 'running';
  if (dbStatus === 'ok') return 'success';
  if (dbStatus === 'cancelled') return 'cancelled';
  return 'failed';
}

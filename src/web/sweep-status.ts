// DB-to-UI status translation.
//
// The crawler writes a granular status string ('in_progress', 'ok', 'partial',
// 'failed', 'circuit_open', 'cancelled') but the operator UI's existing badge
// components only render three states. Map at the API boundary so the UI
// contract stays simple — we can extend the union later if richer statuses
// become operationally important.
export function toUiStatus(dbStatus: string): 'running' | 'success' | 'failed' {
  if (dbStatus === 'in_progress') return 'running';
  if (dbStatus === 'ok') return 'success';
  return 'failed';
}

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { StatusDot } from '@/components/ui/StatusDot.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface SweepRun {
  id: string;
  startedAt: string;
  durationMs: number;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  trigger?: string;
  pagesFetched: number;
  detailsFetched: number;
  newListings: number;
  updatedListings: number;
  errorCount: number;
}
interface CircuitState {
  open: boolean;
  openedAt?: string;
}

interface RunSweepResponse {
  id: number;
  startedAt: string;
}

interface SweepsEnvelope {
  sweeps: SweepRun[];
  total: number;
  limit: number;
  offset: number;
}

const PAGE_SIZE = 20;

export const Sweeps: React.FC = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [page, setPage] = useState(0);
  const { data: envelope } = useQuery<SweepsEnvelope>({
    queryKey: ['sweeps', { page }],
    queryFn: () => apiCall(`/sweeps?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`),
    // Poll every 2s while any sweep is running so durationMs + counter
    // columns stay live; idle list never repolls.
    refetchInterval: (q) =>
      q.state.data?.sweeps?.some((s) => s.status === 'running') ? 2000 : false,
  });
  const sweeps = envelope?.sweeps;
  const total = envelope?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onLastPage = page >= pageCount - 1;
  const { data: circuit } = useQuery<CircuitState>({
    queryKey: ['circuit'],
    queryFn: () => apiCall('/circuit'),
  });

  const reset = useMutation({
    mutationFn: () => apiCall('/circuit', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['circuit'] }),
  });

  // Triggers a real sweep — same code path as the hourly cron (politeness,
  // circuit breaker, full pagination, persistDetail on new + seen stubs so
  // existing rows get price-history snapshots). Returns the id immediately
  // and runs in the background; we navigate to the detail page so the user
  // can watch progress via the live banner + queue depth.
  const runSweep = useMutation<RunSweepResponse>({
    mutationFn: () => apiCall<RunSweepResponse>('/sweeps', { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sweeps'] });
      qc.invalidateQueries({ queryKey: ['circuit'] });
      navigate(`/sweeps/${data.id}`);
    },
  });

  // Bounded 3-listing sweep + DB assertions for fast post-deploy validation.
  // Like runSweep, this is non-blocking — navigates to the detail page so
  // the operator can watch progress live via SSE. Assertions render on the
  // detail page once the sweep finishes (GET /sweeps/:id/smoke-assertions).
  const smoke = useMutation<RunSweepResponse>({
    mutationFn: () => apiCall<RunSweepResponse>('/sweeps/smoke', { method: 'POST' }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sweeps'] });
      qc.invalidateQueries({ queryKey: ['circuit'] });
      navigate(`/sweeps/${data.id}`);
    },
  });

  // Success rate is computed over the *current page* only — same behavior as
  // before pagination, just relabeled in the subtitle so the operator knows
  // it's a window, not a lifetime metric.
  const successRate = sweeps?.length
    ? sweeps.filter((s) => s.status === 'success').length / sweeps.length
    : 0;

  return (
    <div data-screen-label="Sweeps">
      <div className="flex items-start justify-between mb-2">
        <PageHeader
          title="Sweeps"
          subtitle={`${total} runs · ${Math.round(successRate * 100)}% success on page ${page + 1}`}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => smoke.mutate()}
            disabled={smoke.isPending || runSweep.isPending || circuit?.open}
            title={circuit?.open ? 'Circuit breaker open — reset before running smoke' : undefined}
          >
            {smoke.isPending ? 'Running smoke… ~30s' : 'Run smoke'}
          </Button>
          <Button
            onClick={() => runSweep.mutate()}
            disabled={runSweep.isPending || smoke.isPending || circuit?.open}
            title={
              circuit?.open ? 'Circuit breaker open — reset before running a sweep' : undefined
            }
          >
            {runSweep.isPending ? 'Starting…' : 'Run sweep now'}
          </Button>
        </div>
      </div>

      {smoke.isError && (
        <div className="mb-6 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-error">
          Smoke request failed: {(smoke.error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      {runSweep.isError && (
        <div className="mb-6 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-error">
          Sweep trigger failed: {(runSweep.error as Error)?.message ?? 'unknown error'}
        </div>
      )}

      <div
        className={`mb-6 rounded-sm border p-4 flex items-center gap-4 ${circuit?.open ? 'bg-red-50 border-red-200' : 'bg-white border-neutral-200'}`}
      >
        <div
          className={`grid h-10 w-10 place-items-center rounded-full ${circuit?.open ? 'bg-red-100 text-error' : 'bg-green-50 text-success'}`}
        >
          {circuit?.open ? '!' : '✓'}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              Circuit breaker {circuit?.open ? 'open' : 'closed'}
            </span>
            {circuit?.open && <Badge variant="error">crawler paused</Badge>}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">
            {circuit?.open
              ? 'Crawler paused after consecutive failures. Will resume in 24h unless reset.'
              : 'Trips after 3 consecutive failures.'}
          </p>
        </div>
        {circuit?.open && (
          <Button variant="destructive" onClick={() => reset.mutate()} disabled={reset.isPending}>
            {reset.isPending ? 'Resetting…' : 'Reset breaker'}
          </Button>
        )}
      </div>

      <Card className="!p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
              <th className="px-5 py-2.5">Started</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5 text-right">Duration</th>
              <th className="px-3 py-2.5 text-right">Pages</th>
              <th className="px-3 py-2.5 text-right">Details</th>
              <th className="px-3 py-2.5 text-right">New</th>
              <th className="px-3 py-2.5 text-right pr-5">Errors</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {sweeps?.map((s) => (
              <tr
                key={s.id}
                onClick={() => navigate(`/sweeps/${s.id}`)}
                className="hover:bg-neutral-50 cursor-pointer"
              >
                <td className="px-5 py-2.5">
                  <div className="text-neutral-900 flex items-center gap-1.5">
                    {fmt.date(s.startedAt)}
                    {s.trigger === 'smoke' && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[10px] font-medium uppercase tracking-wider">
                        smoke
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-neutral-400">
                    {fmt.rel(s.startedAt)} · <span className="font-mono">{s.id}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {s.status === 'success' && <Badge variant="success">success</Badge>}
                  {s.status === 'failed' && <Badge variant="error">failed</Badge>}
                  {s.status === 'cancelled' && <Badge variant="default">cancelled</Badge>}
                  {s.status === 'running' && (
                    <Badge variant="warning">
                      <span className="inline-flex items-center gap-1">
                        <StatusDot tone="warning" pulse />
                        running
                      </span>
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmt.ms(s.durationMs)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.pagesFetched}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{s.detailsFetched}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {s.newListings > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(
                          `/listings?firstSeenAfter=${encodeURIComponent(s.startedAt)}&fromSweep=${s.id}&sort=newest`,
                        );
                      }}
                      className="font-semibold text-accent-dark hover:underline"
                    >
                      +{s.newListings}
                    </button>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-right pr-5">
                  {s.errorCount > 0 ? (
                    <Badge variant="error">{s.errorCount}</Badge>
                  ) : (
                    <span className="text-neutral-400">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {total > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            ← Prev
          </Button>
          <span className="text-xs tabular-nums text-neutral-500">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total} · page{' '}
            {page + 1} of {pageCount}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={onLastPage}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  );
};

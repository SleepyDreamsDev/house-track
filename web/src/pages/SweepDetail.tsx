import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { StatusDot } from '@/components/ui/StatusDot.js';
import { KStat } from '@/components/ui/KStat.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import { useSse } from '@/lib/sse.js';
import { fmt } from '@/lib/format.js';

interface SweepEvent {
  t: string;
  lvl: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  meta?: string;
}
interface PageRow {
  n: number;
  url: string;
  status: number;
  bytes: number;
  parseMs: number;
  found: number;
  took: number;
}
interface DetailRow {
  id: string;
  url: string;
  status: number;
  bytes: number;
  parseMs: number;
  action: 'new' | 'updated';
  priceEur: number;
}
interface SweepDetailDto {
  id: string;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt?: string;
  source: string;
  trigger: string;
  config: Record<string, unknown>;
  summary?: {
    pagesFetched: number;
    detailsFetched: number;
    newListings: number;
    updatedListings: number;
    errors: number;
    durationMs: number;
  };
  progress?: {
    phase: string;
    pagesDone: number;
    pagesTotal: number;
    detailsDone: number;
    detailsQueued: number;
    newCount: number;
    updatedCount: number;
  };
  currentlyFetching?: { url: string; startedAt: number };
  pages?: PageRow[];
  details?: DetailRow[];
  errors?: { url: string; status: number; msg: string; attempts: number }[];
  logTail: SweepEvent[];
}

type Tab = 'overview' | 'http' | 'events' | 'errors' | 'config';

export const SweepDetail: React.FC = () => {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('overview');

  const { data: detail, refetch } = useQuery<SweepDetailDto>({
    queryKey: ['sweep', id],
    queryFn: () => apiCall(`/sweeps/${id}`),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });

  // Live SSE — appends to log tail when running
  const live = detail?.status === 'running';
  const liveEvents = useSse<SweepEvent>(`/api/sweeps/${id}/stream`, !!live);
  useEffect(() => {
    if (liveEvents.length) refetch();
  }, [liveEvents.length, refetch]);

  const cancel = useMutation({
    mutationFn: () => apiCall(`/sweeps/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => refetch(),
  });

  if (!detail) return <p className="text-sm text-neutral-400">Loading…</p>;

  return (
    <div data-screen-label="Sweep detail">
      <div className="mb-4 flex items-center gap-2 text-xs">
        <button onClick={() => nav('/sweeps')} className="text-neutral-400 hover:text-neutral-900">
          Sweeps
        </button>
        <span className="text-neutral-200">/</span>
        <span className="font-mono text-neutral-600">{detail.id}</span>
      </div>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>
              Sweep <span className="font-mono text-neutral-400">{detail.id}</span>
            </span>
            {live && (
              <Badge variant="warning">
                <span className="inline-flex items-center gap-1">
                  <StatusDot tone="warning" pulse />
                  running
                </span>
              </Badge>
            )}
            {detail.status === 'success' && <Badge variant="success">success</Badge>}
            {detail.status === 'failed' && <Badge variant="error">failed</Badge>}
            {detail.status === 'cancelled' && <Badge variant="default">cancelled</Badge>}
          </span>
        }
        subtitle={`${detail.source} · ${detail.trigger} · started ${fmt.rel(detail.startedAt)}`}
        actions={
          <>
            {live && (
              <Button
                variant="destructive"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
              >
                {cancel.isPending ? 'Cancelling…' : 'Cancel sweep'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => nav('/sweeps')}>
              ← Back
            </Button>
          </>
        }
      />

      {live && detail.progress && (
        <Card className="mb-6 !border-amber-200">
          <div className="flex items-center gap-2 mb-3">
            <StatusDot tone="warning" pulse />
            <span className="text-sm font-semibold">Live · phase: {detail.progress.phase}</span>
          </div>
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center mb-3">
            <div>
              <div className="flex justify-between mb-1 text-xs">
                <span className="text-neutral-600">Index pages</span>
                <span className="tabular-nums text-neutral-600">
                  {detail.progress.pagesDone} / {detail.progress.pagesTotal}
                </span>
              </div>
              <div className="h-2 rounded-full bg-neutral-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-all duration-500"
                  style={{
                    width: `${(detail.progress.pagesDone / detail.progress.pagesTotal) * 100}%`,
                  }}
                />
              </div>
            </div>
            <KStat label="Queued" value={detail.progress.detailsQueued} />
            <KStat label="Updated" value={detail.progress.updatedCount} />
            <KStat label="New" value={detail.progress.newCount} tone="accent" />
          </div>
          {detail.currentlyFetching && (
            <div className="flex items-center gap-2 rounded-sm bg-white border border-neutral-200 px-3 py-2 text-xs">
              <StatusDot tone="warning" pulse />
              <span className="text-neutral-400 shrink-0">Fetching</span>
              <code className="font-mono text-neutral-600 truncate flex-1">
                {detail.currentlyFetching.url}
              </code>
            </div>
          )}
        </Card>
      )}

      {!live && detail.summary && (
        <Card className="mb-6 !p-0">
          <div className="grid grid-cols-5 divide-x divide-neutral-200">
            <div className="p-4">
              <KStat label="Duration" value={fmt.ms(detail.summary.durationMs)} />
            </div>
            <div className="p-4">
              <KStat label="Pages" value={detail.summary.pagesFetched} />
            </div>
            <div className="p-4">
              <KStat label="Details" value={detail.summary.detailsFetched} />
            </div>
            <div className="p-4">
              <KStat label="New" value={detail.summary.newListings} tone="accent" />
            </div>
            <div className="p-4">
              <KStat label="Errors" value={detail.summary.errors} />
            </div>
          </div>
        </Card>
      )}

      <div className="mb-4 flex items-center gap-1 border-b border-neutral-200">
        {(['overview', 'http', 'events', 'errors', 'config'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-neutral-900 text-neutral-900' : 'border-transparent text-neutral-400 hover:text-neutral-900'}`}
          >
            {t === 'http' ? 'HTTP log' : t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'events' && ` · ${detail.logTail.length}`}
            {t === 'errors' && detail.errors?.length ? ` · ${detail.errors.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab detail={detail} />}
      {tab === 'http' && <HttpTab detail={detail} />}
      {tab === 'events' && <EventsTab detail={detail} live={!!live} />}
      {tab === 'errors' && <ErrorsTab detail={detail} />}
      {tab === 'config' && <ConfigTab detail={detail} />}
    </div>
  );
};

const OverviewTab: React.FC<{ detail: SweepDetailDto }> = ({ detail }) => (
  <div className="grid grid-cols-3 gap-6">
    <Card className="col-span-2">
      <SectionHeader title="Index pages" hint={`${detail.pages?.length ?? 0} fetched`} />
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
          <tr>
            <th className="py-1.5 w-8">#</th>
            <th className="py-1.5">URL</th>
            <th className="py-1.5 text-right">Status</th>
            <th className="py-1.5 text-right">Bytes</th>
            <th className="py-1.5 text-right">Found</th>
            <th className="py-1.5 text-right">Took</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {(detail.pages ?? []).map((p) => (
            <tr key={p.n}>
              <td className="py-1.5 tabular-nums text-neutral-400">{p.n}</td>
              <td className="py-1.5">
                <code className="font-mono text-neutral-600 truncate block max-w-[280px]">
                  {p.url}
                </code>
              </td>
              <td className="py-1.5 text-right">
                <Badge variant={p.status === 200 ? 'success' : 'error'}>{p.status}</Badge>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {p.bytes ? fmt.bytes(p.bytes) : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums">{p.found || '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt.ms(p.took)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
    <Card>
      <SectionHeader title="Tail" />
      <div className="space-y-1 max-h-[280px] overflow-auto font-mono text-[11px]">
        {[...detail.logTail]
          .slice(-12)
          .reverse()
          .map((e, i) => (
            <LogLine key={i} e={e} />
          ))}
      </div>
    </Card>
  </div>
);

const HttpTab: React.FC<{ detail: SweepDetailDto }> = ({ detail }) => {
  const all = [
    ...(detail.pages ?? []).map((p) => ({
      kind: 'index' as const,
      ...p,
      identifier: `page=${p.n}`,
    })),
    ...(detail.details ?? []).map((d) => ({
      kind: 'detail' as const,
      ...d,
      identifier: `id=${d.id}`,
      took: d.parseMs,
      found: 0,
      n: 0,
    })),
  ];
  return (
    <Card className="!p-0">
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
          <tr>
            <th className="px-4 py-2">Kind</th>
            <th className="px-3 py-2">Identifier</th>
            <th className="px-3 py-2">URL</th>
            <th className="px-3 py-2 text-right">Status</th>
            <th className="px-3 py-2 text-right">Bytes</th>
            <th className="px-3 py-2 text-right pr-4">Took</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {all.map((r, i) => (
            <tr key={i}>
              <td className="px-4 py-2">
                <Badge variant="default">{r.kind}</Badge>
              </td>
              <td className="px-3 py-2 font-mono">{r.identifier}</td>
              <td className="px-3 py-2">
                <code className="font-mono text-neutral-400">{r.url}</code>
              </td>
              <td className="px-3 py-2 text-right">
                <Badge variant={r.status >= 400 ? 'error' : 'success'}>{r.status}</Badge>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {r.bytes ? fmt.bytes(r.bytes) : '—'}
              </td>
              <td className="px-3 py-2 text-right tabular-nums pr-4">
                {r.took ? fmt.ms(r.took) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

const EventsTab: React.FC<{ detail: SweepDetailDto; live: boolean }> = ({ detail, live }) => (
  <Card>
    <SectionHeader
      title="Event log"
      hint={live ? 'streaming' : `${detail.logTail.length} events`}
    />
    <div className="space-y-1 max-h-[560px] overflow-auto font-mono text-xs">
      {[...detail.logTail].reverse().map((e, i) => (
        <LogLine key={i} e={e} />
      ))}
    </div>
  </Card>
);

const ErrorsTab: React.FC<{ detail: SweepDetailDto }> = ({ detail }) => {
  if (!detail.errors?.length)
    return (
      <Card>
        <p className="py-12 text-center text-sm text-neutral-400">
          No errors. This sweep ran cleanly.
        </p>
      </Card>
    );
  return (
    <Card className="!p-0">
      <table className="w-full text-xs">
        <thead className="text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-400 border-b border-neutral-200">
          <tr>
            <th className="px-4 py-2">URL</th>
            <th className="px-3 py-2 text-right">Status</th>
            <th className="px-3 py-2 text-right">Attempts</th>
            <th className="px-3 py-2 pr-4">Message</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {detail.errors.map((e, i) => (
            <tr key={i} className="bg-red-50/30">
              <td className="px-4 py-2 font-mono text-neutral-600">{e.url}</td>
              <td className="px-3 py-2 text-right">
                <Badge variant="error">{e.status}</Badge>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">{e.attempts}</td>
              <td className="px-3 py-2 pr-4 text-error">{e.msg}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};

const ConfigTab: React.FC<{ detail: SweepDetailDto }> = ({ detail }) => (
  <Card>
    <SectionHeader title="Config snapshot" hint="settings as resolved at sweep start" />
    <pre className="font-mono text-xs bg-neutral-50 border border-neutral-200 rounded-sm p-4 overflow-auto">
      {JSON.stringify(detail.config, null, 2)}
    </pre>
  </Card>
);

const LogLine: React.FC<{ e: SweepEvent }> = ({ e }) => {
  const tone =
    e.lvl === 'error'
      ? 'text-error'
      : e.lvl === 'warn'
        ? 'text-warning'
        : e.lvl === 'debug'
          ? 'text-neutral-400'
          : 'text-neutral-600';
  return (
    <div className="flex gap-2 leading-5">
      <span className="text-neutral-400 tabular-nums shrink-0">{e.t}</span>
      <span className={`shrink-0 w-12 uppercase font-semibold ${tone}`}>{e.lvl}</span>
      <span className={`shrink-0 font-medium ${tone}`}>{e.msg}</span>
      <span className="text-neutral-400 truncate">{e.meta}</span>
    </div>
  );
};

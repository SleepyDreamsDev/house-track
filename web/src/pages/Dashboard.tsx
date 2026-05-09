import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { KStat } from '@/components/ui/KStat.js';
import { Sparkline } from '@/components/ui/Sparkline.js';
import { StatusDot } from '@/components/ui/StatusDot.js';
import { PhotoPlaceholder } from '@/components/ui/PhotoPlaceholder.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface Listing {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceWas?: number | null;
  areaSqm: number | null;
  landSqm?: number | null;
  rooms: number | null;
  floors?: number;
  district: string | null;
  street?: string | null;
  firstSeenAt: string;
  flags?: string[];
  isNew?: boolean;
  priceDrop?: boolean;
}
interface DistrictRow {
  name: string;
  count: number;
  eurPerSqm: number;
}
interface SweepStatus {
  status: 'running' | 'success' | 'failed' | 'cancelled';
  durationMs: number;
  startedAt: string;
}
interface Setting {
  key: string;
  value: unknown;
}
interface CircuitState {
  open: boolean;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { data: newToday } = useQuery<Listing[]>({
    queryKey: ['newToday'],
    queryFn: () => apiCall('/listings/new-today'),
  });
  const { data: drops } = useQuery<Listing[]>({
    queryKey: ['drops'],
    queryFn: () => apiCall('/listings/price-drops'),
  });
  const { data: districts } = useQuery<DistrictRow[]>({
    queryKey: ['byDistrict'],
    queryFn: () => apiCall('/stats/by-district'),
  });
  const { data: newPerDay } = useQuery<number[]>({
    queryKey: ['newPerDay'],
    queryFn: () => apiCall('/stats/new-per-day'),
  });
  const { data: latestSweep } = useQuery<SweepStatus>({
    queryKey: ['sweeps', 'latest'],
    queryFn: () => apiCall('/sweeps/latest'),
  });
  const { data: circuit } = useQuery<CircuitState>({
    queryKey: ['circuit'],
    queryFn: () => apiCall('/circuit'),
  });
  const { data: successRateData } = useQuery<{
    rate: number;
    ok: number;
    total: number;
    window: number;
  }>({
    queryKey: ['successRate'],
    queryFn: () => apiCall('/stats/success-rate'),
  });
  const { data: avgPriceData } = useQuery<{ avgPrice: number; count: number }>({
    queryKey: ['avgPrice'],
    queryFn: () => apiCall('/stats/avg-price'),
  });
  const { data: settings } = useQuery<Setting[]>({
    queryKey: ['settings'],
    queryFn: () => apiCall('/settings'),
  });

  const queryClient = useQueryClient();
  const runSweep = useMutation({
    mutationFn: () => apiCall('/sweeps', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sweeps'] });
      queryClient.invalidateQueries({ queryKey: ['sweeps', 'latest'] });
    },
  });

  const totalActive = districts?.reduce((a, d) => a + d.count, 0) ?? 0;
  const successRate = successRateData?.rate ?? 0;
  const avgPrice = avgPriceData?.avgPrice ?? 0;
  const grafanaUrl =
    (settings?.find((s) => s.key === 'monitoring.grafanaUrl')?.value as string) ?? '';

  return (
    <div className="space-y-6" data-screen-label="Dashboard">
      <PageHeader
        title="Dashboard"
        subtitle={`last sweep ${latestSweep ? fmt.rel(latestSweep.startedAt) : '—'}`}
        actions={
          <>
            {grafanaUrl && (
              <Button
                variant="secondary"
                onClick={() => window.open(grafanaUrl, '_blank', 'noopener,noreferrer')}
              >
                Open Grafana
              </Button>
            )}
            <Button
              variant="default"
              onClick={() => runSweep.mutate()}
              disabled={runSweep.isPending || circuit?.open}
            >
              {runSweep.isPending ? 'Starting…' : 'Run sweep now'}
            </Button>
          </>
        }
      />

      <Card className="!p-0">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-5">
            <KStat
              label="Active listings"
              value={fmt.num(totalActive)}
              hint="all sources"
              trend={newPerDay && <Sparkline data={newPerDay} />}
            />
          </div>
          <div className="p-5">
            <KStat label="New today" value={newToday?.length ?? 0} tone="accent" />
          </div>
          <div className="p-5">
            <KStat label="Avg price" value={fmt.eur(avgPrice)} />
          </div>
          <div className="p-5">
            <KStat
              label="Sweep success"
              value={`${Math.round(successRate * 100)}%`}
              hint="last 24h"
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <div>
            <SectionHeader
              title="New today"
              hint={`${newToday?.length ?? 0} listings`}
              right={
                <Button size="sm" variant="ghost" onClick={() => navigate('/listings')}>
                  View all listings →
                </Button>
              }
            />
            <div className="space-y-2">
              {(newToday ?? []).map((l) => (
                <LeadRow key={l.id} listing={l} kind="new" />
              ))}
              {newToday && newToday.length === 0 && (
                <Card>
                  <p className="text-sm text-neutral-400 text-center">No new listings yet today</p>
                </Card>
              )}
            </div>
          </div>
          <div>
            <SectionHeader title="Price drops" hint={`${drops?.length ?? 0} this week`} />
            <div className="space-y-2">
              {(drops ?? []).map((l) => (
                <LeadRow key={l.id} listing={l} kind="drop" />
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Card>
            <SectionHeader title="Crawler health" />
            <div className="space-y-3 text-sm">
              <Row
                label="Last sweep"
                value={
                  <Badge
                    variant={
                      latestSweep?.status === 'success'
                        ? 'success'
                        : latestSweep?.status === 'failed'
                          ? 'error'
                          : latestSweep?.status === 'cancelled'
                            ? 'default'
                            : 'warning'
                    }
                  >
                    {latestSweep?.status ?? '—'}
                  </Badge>
                }
              />
              <Row
                label="Circuit breaker"
                value={
                  <Badge variant={circuit?.open ? 'error' : 'success'}>
                    {circuit?.open ? 'open' : 'closed'}
                  </Badge>
                }
              />
              <Row
                label="Crawler"
                value={
                  <span className="flex items-center gap-1.5">
                    <StatusDot tone={circuit?.open ? 'error' : 'success'} pulse={!circuit?.open} />
                    <span className="text-neutral-600">{circuit?.open ? 'paused' : 'running'}</span>
                  </span>
                }
              />
            </div>
          </Card>

          <Card>
            <SectionHeader title="By district" hint="active · €/m² avg" />
            <div className="space-y-2">
              {(districts ?? []).map((d) => {
                const max = Math.max(...(districts ?? []).map((x) => x.count), 1);
                return (
                  <div key={d.name} className="flex items-center gap-3 text-xs">
                    <span className="w-20 text-neutral-600">{d.name}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${(d.count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-7 text-right tabular-nums text-neutral-400">{d.count}</span>
                    <span className="w-14 text-right tabular-nums text-neutral-400">
                      €{d.eurPerSqm}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-neutral-400">{label}</span>
    {value}
  </div>
);

const LeadRow: React.FC<{ listing: Listing; kind: 'new' | 'drop' }> = ({ listing: l, kind }) => {
  const drop =
    l.priceWas && l.priceEur && l.priceWas > l.priceEur
      ? Math.round((1 - l.priceEur / l.priceWas) * 100)
      : null;
  const eurPerSqm = l.areaSqm && l.priceEur ? Math.round(l.priceEur / l.areaSqm) : 0;
  return (
    <a
      href={l.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center gap-4 rounded-sm bg-white p-3 border border-neutral-200 hover:border-neutral-400 transition-colors"
    >
      <PhotoPlaceholder id={l.id} className="h-16 w-24 shrink-0" label="999.md" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          {kind === 'new' && <Badge variant="default">NEW · {fmt.rel(l.firstSeenAt)}</Badge>}
          {kind === 'drop' && drop && <Badge variant="warning">−{drop}%</Badge>}
        </div>
        <div className="truncate text-sm font-medium text-neutral-900">{l.title}</div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-neutral-400">
          <span>
            {l.district}
            {l.street ? ` · ${l.street}` : ''}
          </span>
          <span className="tabular-nums">{l.areaSqm} m²</span>
          {l.rooms && <span className="tabular-nums">{l.rooms} rooms</span>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-base font-semibold tabular-nums text-neutral-900">
          {fmt.eur(l.priceEur)}
        </div>
        {l.priceWas && (
          <div className="text-xs tabular-nums text-neutral-400 line-through">
            {fmt.eur(l.priceWas)}
          </div>
        )}
        <div className="text-xs tabular-nums text-neutral-400">€{eurPerSqm}/m²</div>
      </div>
    </a>
  );
};

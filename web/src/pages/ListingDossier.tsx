import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { Badge } from '@/components/ui/Badge.js';
import { KStat } from '@/components/ui/KStat.js';
import { ListingThumb } from '@/components/ui/ListingThumb.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { PriceHistoryPanel } from '@/components/listings/PriceHistoryPanel.js';
import { apiCall } from '@/lib/api.js';
import { fmt } from '@/lib/format.js';

interface ListingDetail {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  rooms: number | null;
  areaSqm: number | null;
  landAre: number | null;
  district: string | null;
  street: string | null;
  floors: number | null;
  yearBuilt: number | null;
  heatingType: string | null;
  description: string | null;
  imageUrls: string[];
  primaryImage: string | null;
  active: boolean;
  watchlist: boolean;
  excluded: boolean;
  firstSeenAt: string;
}

interface DossierListingRef {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  active: boolean;
  delistedAt: string | null;
}

interface Dossier {
  activeDOM: number;
  domMedianDistrict: number | null;
  hedonic: { predictedEur: number; residualPct: number } | null;
  postedAt: string | null;
  bumpedAt: string | null;
  authorName: string | null;
  authorListings: DossierListingRef[];
  cluster: {
    canonicalId: string;
    members: (DossierListingRef & { firstSeenAt: string })[];
  } | null;
}

export const ListingDossier: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const listingQ = useQuery<ListingDetail>({
    queryKey: ['listing', id],
    queryFn: () => apiCall<ListingDetail>(`/listings/${id}`),
    enabled: !!id,
  });
  const dossierQ = useQuery<Dossier>({
    queryKey: ['listing-dossier', id],
    queryFn: () => apiCall<Dossier>(`/listings/${id}/dossier`),
    enabled: !!id,
  });

  if (listingQ.isError) {
    return (
      <Card>
        <p className="text-sm text-neutral-500 text-center">
          Listing not found.{' '}
          <Link to="/listings" className="text-teal-700 hover:underline">
            ← Back to Listings
          </Link>
        </p>
      </Card>
    );
  }

  const l = listingQ.data;
  const d = dossierQ.data;
  if (!l) return <div className="text-sm text-neutral-400">Loading…</div>;

  const eurPerSqm = l.priceEur && l.areaSqm ? Math.round(l.priceEur / l.areaSqm) : null;
  const residual = d?.hedonic?.residualPct;

  return (
    <div className="space-y-5" data-screen-label="Listing dossier">
      <PageHeader
        title={l.title}
        subtitle={[
          l.district,
          l.street,
          l.rooms ? `${l.rooms} rooms` : null,
          l.areaSqm ? `${l.areaSqm} m²` : null,
          l.yearBuilt ? `built ${l.yearBuilt}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm border border-neutral-300 px-2.5 py-1 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            Open on 999.md ↗
          </a>
        }
      />

      <div className="flex items-center gap-2">
        <Badge variant={l.active ? 'success' : 'error'}>{l.active ? 'active' : 'delisted'}</Badge>
        {l.watchlist && <Badge variant="default">★ favorite</Badge>}
        {l.excluded && <Badge variant="warning">excluded</Badge>}
        {d?.bumpedAt && <Badge variant="default">bumped {fmt.rel(d.bumpedAt)}</Badge>}
      </div>

      <Card className="!p-0">
        <div className="grid grid-cols-4 divide-x divide-neutral-200">
          <div className="p-4">
            <KStat label="Price" value={fmt.eur(l.priceEur)} tone="accent" />
          </div>
          <div className="p-4">
            <KStat label="€/m²" value={eurPerSqm != null ? `€${eurPerSqm}` : '—'} />
          </div>
          <div className="p-4">
            <KStat
              label="Days on market"
              value={d ? `${d.activeDOM}d` : '—'}
              hint={d?.domMedianDistrict != null ? `vs ${d.domMedianDistrict}d median` : undefined}
            />
          </div>
          <div className="p-4">
            <KStat
              label="vs model"
              value={
                residual != null ? `${residual > 0 ? '+' : ''}${Math.round(residual * 100)}%` : '—'
              }
              hint={d?.hedonic ? `fair ≈ ${fmt.eur(d.hedonic.predictedEur)}` : undefined}
            />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-2 space-y-5">
          <Card className="!p-0 overflow-hidden">
            <ListingThumb
              id={l.id}
              src={l.primaryImage}
              className="h-64 w-full"
              label="999.md"
              alt={l.title}
            />
          </Card>

          {l.description && (
            <Card>
              <SectionHeader title="Description" />
              <p className="whitespace-pre-wrap text-sm text-neutral-700">{l.description}</p>
            </Card>
          )}

          <Card className="!p-0 overflow-hidden">
            <PriceHistoryPanel listingId={l.id} />
          </Card>
        </div>

        <div className="space-y-5">
          {d?.cluster && (
            <Card>
              <SectionHeader
                title="Duplicates / relists"
                hint={`${d.cluster.members.length} in cluster`}
              />
              <div className="space-y-2">
                {d.cluster.members.map((m) => (
                  <RefRow key={m.id} item={m} />
                ))}
              </div>
            </Card>
          )}

          {d && d.authorListings.length > 0 && (
            <Card>
              <SectionHeader title="Same seller" hint={d.authorName ?? undefined} />
              <div className="space-y-2">
                {d.authorListings.map((m) => (
                  <RefRow key={m.id} item={m} />
                ))}
              </div>
            </Card>
          )}

          <Card>
            <SectionHeader title="Timeline" />
            <div className="space-y-2 text-sm">
              <TimelineRow label="First seen" value={fmt.rel(l.firstSeenAt)} />
              {d?.postedAt && <TimelineRow label="Posted" value={fmt.rel(d.postedAt)} />}
              {d?.bumpedAt && <TimelineRow label="Bumped" value={fmt.rel(d.bumpedAt)} />}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const RefRow: React.FC<{ item: DossierListingRef }> = ({ item }) => (
  <div className="flex items-center justify-between gap-2 text-sm">
    <div className="min-w-0">
      <Link
        to={`/listings/${item.id}`}
        className="block truncate text-neutral-800 hover:text-teal-700 hover:underline"
        title={item.title}
      >
        {item.title}
      </Link>
      <span className="text-xs text-neutral-400">
        {item.active
          ? 'active'
          : `delisted${item.delistedAt ? ` ${fmt.rel(item.delistedAt)}` : ''}`}
      </span>
    </div>
    <span className="shrink-0 tabular-nums font-medium text-neutral-700">
      {fmt.eur(item.priceEur)}
    </span>
  </div>
);

const TimelineRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between">
    <span className="text-neutral-400">{label}</span>
    <span className="text-neutral-700">{value}</span>
  </div>
);

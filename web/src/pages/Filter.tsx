import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button.js';
import { Card } from '@/components/ui/Card.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import {
  CATEGORIES,
  type ExtraFilterTriple,
  type GenericFilter,
  genericFilterSchema,
  LOCALITIES,
  type Locality,
  TRANSACTION_TYPES,
} from '@/lib/filterSchema.js';

interface FilterResponse {
  generic: GenericFilter;
  sources: Array<{ slug: string; name: string; active: boolean }>;
  resolved: {
    searchInput: { subCategoryId: number; filters: unknown };
    postFilter: { maxPriceEur: number; maxAreaSqm: number };
  };
  sourceSlug: string;
}

interface FilterFacet {
  filterId: number;
  featureId: number;
  optionIds: number[];
  listingCount: number;
  sampleListingIds: string[];
}

const NUMERIC_FIELDS = ['priceMin', 'priceMax', 'sqmMin', 'sqmMax'] as const;

export const Filter: React.FC = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<FilterResponse>({
    queryKey: ['filter'],
    queryFn: () => apiCall('/filter'),
  });
  const { data: facets } = useQuery<FilterFacet[]>({
    queryKey: ['filter-facets'],
    queryFn: () => apiCall('/filters'),
  });

  const [draft, setDraft] = useState<GenericFilter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.generic && draft === null) {
      setDraft({
        ...data.generic,
        locality: [...data.generic.locality],
        extraFilters: (data.generic.extraFilters ?? []).map((t) => ({
          ...t,
          optionIds: [...t.optionIds],
        })),
      });
    }
  }, [data, draft]);

  const save = useMutation<FilterResponse, Error, GenericFilter>({
    mutationFn: (payload) =>
      apiCall<FilterResponse>('/filter', {
        method: 'PUT',
        body: JSON.stringify({ generic: payload }),
      }),
    onSuccess: (next) => {
      qc.setQueryData(['filter'], next);
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  if (isLoading || !draft || !data) {
    return (
      <div data-screen-label="Filter">
        <PageHeader title="Filter" subtitle="Loading…" />
      </div>
    );
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.generic);

  function update<K extends keyof GenericFilter>(key: K, value: GenericFilter[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function setNumber(key: (typeof NUMERIC_FIELDS)[number], raw: string) {
    if (raw === '') {
      update(key, undefined as never);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) update(key, n as never);
  }

  function toggleLocality(loc: Locality) {
    if (!draft) return;
    const has = draft.locality.includes(loc);
    const next = has ? draft.locality.filter((l) => l !== loc) : [...draft.locality, loc];
    update('locality', next);
  }

  function toggleExtraOption(filterId: number, featureId: number, optionId: number) {
    if (!draft) return;
    const matchIdx = draft.extraFilters.findIndex(
      (t) => t.filterId === filterId && t.featureId === featureId,
    );
    const next = draft.extraFilters.map((t) => ({ ...t, optionIds: [...t.optionIds] }));
    if (matchIdx === -1) {
      next.push({ filterId, featureId, optionIds: [optionId] });
    } else {
      const current = next[matchIdx]!;
      const has = current.optionIds.includes(optionId);
      current.optionIds = has
        ? current.optionIds.filter((o) => o !== optionId)
        : [...current.optionIds, optionId];
      if (current.optionIds.length === 0) next.splice(matchIdx, 1);
    }
    update('extraFilters', next);
  }

  function isExtraSelected(filterId: number, featureId: number, optionId: number): boolean {
    if (!draft) return false;
    const triple = draft.extraFilters.find(
      (t) => t.filterId === filterId && t.featureId === featureId,
    );
    return triple?.optionIds.includes(optionId) ?? false;
  }

  function onSave() {
    if (!draft) return;
    const parsed = genericFilterSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join(' · '),
      );
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  }

  function onReset() {
    if (data)
      setDraft({
        ...data.generic,
        locality: [...data.generic.locality],
        extraFilters: (data.generic.extraFilters ?? []).map((t) => ({
          ...t,
          optionIds: [...t.optionIds],
        })),
      });
    setError(null);
  }

  return (
    <div data-screen-label="Filter" className="space-y-6">
      <PageHeader
        title="Filter"
        subtitle="Generic search filter — translated to source-specific params at sweep start"
      />

      <div className="grid grid-cols-[200px_1fr] gap-8">
        <nav className="sticky top-0 self-start space-y-0.5 text-sm">
          <a
            href="#Source"
            className="block rounded-sm px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            Source
          </a>
          <a
            href="#Generic"
            className="block rounded-sm px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            Generic filter
          </a>
          <a
            href="#Dynamic"
            className="block rounded-sm px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            Source filters
          </a>
          <a
            href="#Resolved"
            className="block rounded-sm px-2.5 py-1.5 text-neutral-600 hover:bg-neutral-100"
          >
            Resolved
          </a>
        </nav>

        <div className="space-y-6">
          <Card id="Source">
            <SectionHeader title="Source" />
            <div className="py-3">
              <label className="block text-xs font-medium text-neutral-500 mb-1">
                Active source
              </label>
              <select
                disabled={data.sources.length <= 1}
                value={data.sourceSlug}
                onChange={() => {
                  /* single-source for now; future: PATCH /api/filter?source=… */
                }}
                className="h-8 w-full max-w-sm rounded-sm bg-white px-2 text-sm border border-neutral-200 disabled:bg-neutral-50 disabled:text-neutral-500"
              >
                {data.sources.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                    {s.active ? ' (active)' : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-neutral-400">
                Adding a source = registering a new mapping in <code>src/sources/</code>. The form
                below stays the same.
              </p>
            </div>
          </Card>

          <Card id="Generic">
            <SectionHeader title="Generic filter" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 py-3">
              <Field label="Transaction type">
                <select
                  value={draft.transactionType}
                  onChange={(e) =>
                    update('transactionType', e.target.value as GenericFilter['transactionType'])
                  }
                  className="h-8 w-full rounded-sm bg-white px-2 text-sm border border-neutral-200"
                >
                  {TRANSACTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Category">
                <select
                  value={draft.category}
                  onChange={(e) => update('category', e.target.value as GenericFilter['category'])}
                  className="h-8 w-full rounded-sm bg-white px-2 text-sm border border-neutral-200"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Locality" wide>
                <div className="flex flex-wrap gap-1.5">
                  {LOCALITIES.map((loc) => {
                    const active = draft.locality.includes(loc);
                    return (
                      <button
                        key={loc}
                        type="button"
                        onClick={() => toggleLocality(loc)}
                        className={`rounded-sm px-2.5 py-1 text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-neutral-900 text-white border-neutral-900'
                            : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                        }`}
                      >
                        {loc}
                      </button>
                    );
                  })}
                </div>
              </Field>

              <Field label="Price min (€)">
                <NumberInput
                  value={draft.priceMin}
                  onChange={(v) => setNumber('priceMin', v)}
                  placeholder="any"
                />
              </Field>
              <Field label="Price max (€)">
                <NumberInput
                  value={draft.priceMax}
                  onChange={(v) => setNumber('priceMax', v)}
                  placeholder="any"
                />
              </Field>

              <Field label="Sqm min">
                <NumberInput
                  value={draft.sqmMin}
                  onChange={(v) => setNumber('sqmMin', v)}
                  placeholder="any"
                />
              </Field>
              <Field label="Sqm max">
                <NumberInput
                  value={draft.sqmMax}
                  onChange={(v) => setNumber('sqmMax', v)}
                  placeholder="any"
                />
              </Field>
            </div>

            {error && (
              <div className="mt-3 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <Button onClick={onSave} disabled={!dirty || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="ghost" onClick={onReset} disabled={!dirty}>
                Reset
              </Button>
              {save.isSuccess && !dirty && (
                <span className="text-xs text-success">Saved · next sweep will use this</span>
              )}
            </div>
          </Card>

          <Card id="Dynamic">
            <SectionHeader title={`Source filters · ${data.sourceSlug}`} />
            <p className="mb-3 mt-1 text-xs text-neutral-500">
              Filter triples observed in detail-fetched listings. Selections AND across triples and
              OR within optionIds. Option IDs are 999.md-internal numbers (labels arrive once filter
              taxonomy is captured — see <code>FILTER_TAXONOMY_QUERY</code>).
            </p>
            {!facets ? (
              <div className="py-3 text-xs text-neutral-400">Loading facets…</div>
            ) : facets.length === 0 ? (
              <div className="py-3 text-xs text-neutral-400">
                No filter values observed yet. Run a sweep to populate.
              </div>
            ) : (
              <div className="divide-y divide-neutral-100">
                {facets.map((f) => {
                  const selectedCount =
                    draft.extraFilters.find(
                      (t) => t.filterId === f.filterId && t.featureId === f.featureId,
                    )?.optionIds.length ?? 0;
                  return (
                    <details
                      key={`${f.filterId}:${f.featureId}`}
                      className="py-2 group"
                      open={selectedCount > 0}
                    >
                      <summary className="flex cursor-pointer items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-neutral-700">
                          filter {f.filterId} · feature {f.featureId}
                        </span>
                        <span className="text-xs text-neutral-400">
                          {f.optionIds.length} options · {f.listingCount} listings
                        </span>
                        {selectedCount > 0 && (
                          <span className="ml-auto rounded-sm bg-neutral-900 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            {selectedCount} selected
                          </span>
                        )}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                        {f.optionIds
                          .slice()
                          .sort((a, b) => a - b)
                          .map((opt) => {
                            const active = isExtraSelected(f.filterId, f.featureId, opt);
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => toggleExtraOption(f.filterId, f.featureId, opt)}
                                className={`rounded-sm px-2 py-0.5 font-mono text-[11px] tabular-nums border transition-colors ${
                                  active
                                    ? 'bg-neutral-900 text-white border-neutral-900'
                                    : 'bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50'
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </Card>

          <Card id="Resolved">
            <SectionHeader title="Resolved (source-specific)" />
            <div className="py-3 space-y-2 text-xs">
              <div className="text-neutral-500">
                What gets sent to <code>{data.sourceSlug}</code>:
              </div>
              <pre className="overflow-x-auto rounded-sm bg-neutral-50 p-3 font-mono text-[11px] text-neutral-700">
                {JSON.stringify(data.resolved, null, 2)}
              </pre>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; wide?: boolean; children: React.ReactNode }> = ({
  label,
  wide,
  children,
}) => (
  <div className={wide ? 'col-span-2' : ''}>
    <label className="block text-xs font-medium text-neutral-500 mb-1">{label}</label>
    {children}
  </div>
);

const NumberInput: React.FC<{
  value: number | undefined;
  onChange: (raw: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <input
    type="number"
    value={value === undefined ? '' : value}
    onChange={(e) => onChange(e.target.value)}
    placeholder={placeholder}
    className="h-8 w-full rounded-sm bg-white px-2.5 text-sm text-right tabular-nums border border-neutral-200"
  />
);

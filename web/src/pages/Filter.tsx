import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button.js';
import { Card } from '@/components/ui/Card.js';
import { PageHeader, SectionHeader } from '@/components/ui/PageHeader.js';
import { apiCall } from '@/lib/api.js';
import {
  CATEGORIES,
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

const NUMERIC_FIELDS = ['priceMin', 'priceMax', 'sqmMin', 'sqmMax'] as const;

export const Filter: React.FC = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<FilterResponse>({
    queryKey: ['filter'],
    queryFn: () => apiCall('/filter'),
  });

  const [draft, setDraft] = useState<GenericFilter | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.generic && draft === null) {
      setDraft({ ...data.generic, locality: [...data.generic.locality] });
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
    if (data) setDraft({ ...data.generic, locality: [...data.generic.locality] });
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

import React, { useState } from 'react';
import { type GenericFilter, type FilterSelection } from '@/lib/filterSchema.js';
import { FilterSection } from './FilterSection.js';
import { OptionsField } from './OptionsField.js';
import { RangeField } from './RangeField.js';
import { BooleanField } from './BooleanField.js';

export interface TaxonomyFeature {
  featureId: number;
  label: string;
  unit?: string;
  // Multi-unit ranges (e.g. price 9441 → [EUR,USD,MDL], land area 1200).
  // When units.length > 1 RangeField renders a unit <select>.
  units?: string[];
  options?: Array<{ id: number; label: string }>;
}

export interface TaxonomyEntry {
  filterId: number;
  label: string;
  kind: 'options' | 'range' | 'boolean';
  features: TaxonomyFeature[];
}

interface FilterFormProps {
  taxonomy: TaxonomyEntry[];
  draft: GenericFilter;
  onChange: (next: GenericFilter) => void;
}

function getOptionsSelection(
  filters: FilterSelection[],
  filterId: number,
  featureId: number,
): number[] {
  const sel = filters.find(
    (f) => f.kind === 'options' && f.filterId === filterId && f.featureId === featureId,
  );
  return sel && sel.kind === 'options' ? sel.optionIds : [];
}

function getRangeSelection(
  filters: FilterSelection[],
  filterId: number,
  featureId: number,
): { min?: string; max?: string; unit?: string } | null {
  const sel = filters.find(
    (f) => f.kind === 'range' && f.filterId === filterId && f.featureId === featureId,
  );
  if (!sel || sel.kind !== 'range') return null;
  const result: { min?: string; max?: string; unit?: string } = {};
  if (sel.min !== undefined) result.min = sel.min;
  if (sel.max !== undefined) result.max = sel.max;
  if (sel.unit !== undefined) result.unit = sel.unit;
  return result;
}

function getBooleanActiveFeatureIds(filters: FilterSelection[], filterId: number): number[] {
  return filters
    .filter((f) => f.kind === 'boolean' && f.filterId === filterId)
    .map((f) => f.featureId);
}

function countSelections(filters: FilterSelection[], filterId: number): number {
  const sels = filters.filter((f) => f.filterId === filterId);
  let count = 0;
  for (const s of sels) {
    if (s.kind === 'options') count += s.optionIds.length;
    else if (s.kind === 'boolean') count += 1;
    else if (s.kind === 'range') count += 1;
  }
  return count;
}

// Key format: `${filterId}:${featureId}`
function rangeKey(filterId: number, featureId: number): string {
  return `${filterId}:${featureId}`;
}

export const FilterForm: React.FC<FilterFormProps> = ({ taxonomy, draft, onChange }) => {
  // Tracks the unit chosen in the picker before any min/max is entered.
  // Once a selection exists, the unit lives on the selection itself.
  const [pendingUnits, setPendingUnits] = useState<Record<string, string>>({});

  function updateFilters(updater: (prev: FilterSelection[]) => FilterSelection[]) {
    onChange({ ...draft, filters: updater(draft.filters) });
  }

  function toggleOption(filterId: number, featureId: number, optionId: number) {
    updateFilters((prev) => {
      const idx = prev.findIndex(
        (f) => f.kind === 'options' && f.filterId === filterId && f.featureId === featureId,
      );
      if (idx === -1) {
        return [...prev, { kind: 'options', filterId, featureId, optionIds: [optionId] }];
      }
      const existing = prev[idx]!;
      if (existing.kind !== 'options') return prev;
      const has = existing.optionIds.includes(optionId);
      const newIds = has
        ? existing.optionIds.filter((o) => o !== optionId)
        : [...existing.optionIds, optionId];
      if (newIds.length === 0) {
        return prev.filter((_, i) => i !== idx);
      }
      return prev.map((f, i) => (i === idx ? { ...existing, optionIds: newIds } : f));
    });
  }

  function updateRange(
    filterId: number,
    featureId: number,
    unit: string | undefined,
    field: 'min' | 'max',
    value: string,
  ) {
    updateFilters((prev) => {
      const idx = prev.findIndex(
        (f) => f.kind === 'range' && f.filterId === filterId && f.featureId === featureId,
      );
      const rawValue = value === '' ? undefined : value;
      if (idx === -1) {
        const sel: FilterSelection = {
          kind: 'range',
          filterId,
          featureId,
          ...(unit !== undefined ? { unit } : {}),
          [field]: rawValue,
        };
        // Only add if there's actually a value
        if (rawValue === undefined) return prev;
        return [...prev, sel];
      }
      const existing = prev[idx]!;
      if (existing.kind !== 'range') return prev;
      const updated = { ...existing, [field]: rawValue };
      // Remove if both undefined
      if (updated.min === undefined && updated.max === undefined) {
        return prev.filter((_, i) => i !== idx);
      }
      return prev.map((f, i) => (i === idx ? updated : f));
    });
  }

  function updateUnit(filterId: number, featureId: number, newUnit: string) {
    // Always track the pending unit (for when a selection is created later)
    setPendingUnits((prev) => ({ ...prev, [rangeKey(filterId, featureId)]: newUnit }));
    // Also update the selection's unit if one already exists
    updateFilters((prev) => {
      const idx = prev.findIndex(
        (f) => f.kind === 'range' && f.filterId === filterId && f.featureId === featureId,
      );
      if (idx === -1) return prev; // no selection yet — pending unit stored above
      const existing = prev[idx]!;
      if (existing.kind !== 'range') return prev;
      return prev.map((f, i) => (i === idx ? { ...existing, unit: newUnit } : f));
    });
  }

  function toggleBoolean(filterId: number, featureId: number) {
    updateFilters((prev) => {
      const existing = prev.find(
        (f) => f.kind === 'boolean' && f.filterId === filterId && f.featureId === featureId,
      );
      if (existing) {
        return prev.filter(
          (f) => !(f.kind === 'boolean' && f.filterId === filterId && f.featureId === featureId),
        );
      }
      return [...prev, { kind: 'boolean', filterId, featureId }];
    });
  }

  return (
    <div className="divide-y divide-neutral-100">
      {taxonomy.map((entry) => {
        const selCount = countSelections(draft.filters, entry.filterId);
        return (
          <FilterSection
            key={entry.filterId}
            label={entry.label}
            selectedCount={selCount}
            defaultOpen={selCount > 0}
          >
            {entry.kind === 'options' &&
              entry.features.map((feat) => (
                <div key={feat.featureId} className="mb-2">
                  {entry.features.length > 1 && (
                    <p className="text-xs text-neutral-400 mb-1">{feat.label}</p>
                  )}
                  <OptionsField
                    options={feat.options ?? []}
                    selectedIds={getOptionsSelection(draft.filters, entry.filterId, feat.featureId)}
                    onToggle={(id) => toggleOption(entry.filterId, feat.featureId, id)}
                  />
                </div>
              ))}

            {entry.kind === 'range' &&
              entry.features.map((feat) => {
                const range = getRangeSelection(draft.filters, entry.filterId, feat.featureId);
                // For multi-unit ranges, prefer the saved selection's unit, then the pending
                // unit chosen in the picker (before any min/max), then feat.unit, then units[0].
                const effUnit =
                  range?.unit ??
                  pendingUnits[rangeKey(entry.filterId, feat.featureId)] ??
                  feat.unit ??
                  feat.units?.[0];
                return (
                  <div key={feat.featureId} className="mb-2">
                    {entry.features.length > 1 && (
                      <p className="text-xs text-neutral-400 mb-1">{feat.label}</p>
                    )}
                    <RangeField
                      {...(range?.min !== undefined ? { min: range.min } : {})}
                      {...(range?.max !== undefined ? { max: range.max } : {})}
                      {...(effUnit !== undefined ? { unit: effUnit } : {})}
                      {...(feat.units !== undefined ? { units: feat.units } : {})}
                      onChangeMin={(v) =>
                        updateRange(entry.filterId, feat.featureId, effUnit, 'min', v)
                      }
                      onChangeMax={(v) =>
                        updateRange(entry.filterId, feat.featureId, effUnit, 'max', v)
                      }
                      onChangeUnit={(u) => updateUnit(entry.filterId, feat.featureId, u)}
                    />
                  </div>
                );
              })}

            {entry.kind === 'boolean' && (
              <BooleanField
                features={entry.features}
                activeFeatureIds={getBooleanActiveFeatureIds(draft.filters, entry.filterId)}
                onToggle={(featureId) => toggleBoolean(entry.filterId, featureId)}
              />
            )}
          </FilterSection>
        );
      })}
    </div>
  );
};

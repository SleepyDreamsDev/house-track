import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBrowseFilters } from '../lib/useBrowseFilters.js';

// useBrowseFilters owns the shared browse-filter state + the maxPrice/facet
// clamp logic that previously lived (subtly differently) in both Listings and
// Analytics. Both pages instantiate it independently — state is per-page.

type Facets = Parameters<typeof useBrowseFilters>[0];

const facetsWithMax = (max: number | null): Facets => ({
  districts: [],
  sectors: [],
  types: [],
  roomsValues: [],
  price: { min: 0, max },
});

describe('useBrowseFilters — maxPrice clamp', () => {
  it('tracks the catalog max while the slider is untouched', () => {
    const { result, rerender } = renderHook((facets: Facets) => useBrowseFilters(facets), {
      initialProps: facetsWithMax(300000),
    });
    expect(result.current.state.maxPrice).toBe(300000);

    rerender(facetsWithMax(180000));
    expect(result.current.state.maxPrice).toBe(180000);
  });

  it('locks to the user-chosen value once the slider is moved', () => {
    const { result, rerender } = renderHook((facets: Facets) => useBrowseFilters(facets), {
      initialProps: facetsWithMax(300000),
    });

    act(() => result.current.setMaxPrice(120000));
    expect(result.current.state.maxPrice).toBe(120000);

    rerender(facetsWithMax(90000));
    expect(result.current.state.maxPrice).toBe(120000);
  });
});

describe('useBrowseFilters — defaults and setters', () => {
  it('starts with the all/empty sentinels for every group', () => {
    const { result } = renderHook(() => useBrowseFilters(undefined));
    const s = result.current.state;
    expect(s.q).toBe('');
    expect(s.districts).toEqual([]);
    expect(s.sectors).toEqual([]);
    expect(s.type).toBe('all');
    expect(s.rooms).toBe('all');
    expect(s.favoritesOnly).toBe(false);
    expect(s.showExcluded).toBe(false);
    expect(s.hideMislabeled).toBe(false);
  });

  it('de-dupes district selections at the setter', () => {
    const { result } = renderHook(() => useBrowseFilters(undefined));
    act(() => result.current.setDistricts(['Centru', 'Centru', 'Botanica']));
    expect(result.current.state.districts).toEqual(['Centru', 'Botanica']);
  });
});

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useBrowseFilters } from '../lib/useBrowseFilters.js';

// useBrowseFilters owns the shared browse-filter state for both pages. Range
// filters (price, area) are null by default — a fresh page sends no range
// params at all. State is per-page.

describe('useBrowseFilters — defaults', () => {
  it('starts with the all/empty/null sentinels for every group', () => {
    const { result } = renderHook(() => useBrowseFilters());
    const s = result.current.state;
    expect(s.q).toBe('');
    expect(s.minPrice).toBeNull();
    expect(s.maxPrice).toBeNull();
    expect(s.minArea).toBeNull();
    expect(s.maxArea).toBeNull();
    expect(s.minLand).toBeNull();
    expect(s.maxLand).toBeNull();
    expect(s.minFloors).toBeNull();
    expect(s.maxFloors).toBeNull();
    expect(s.districts).toEqual([]);
    expect(s.sectors).toEqual([]);
    expect(s.type).toBe('all');
    expect(s.rooms).toBe('all');
    expect(s.favoritesOnly).toBe(false);
    expect(s.showExcluded).toBe(false);
    expect(s.hideMislabeled).toBe(false);
  });
});

describe('useBrowseFilters — setters', () => {
  it('updates the price and area range bounds', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => {
      result.current.setMinPrice(50000);
      result.current.setMaxPrice(120000);
      result.current.setMinArea(60);
      result.current.setMaxArea(200);
    });
    expect(result.current.state.minPrice).toBe(50000);
    expect(result.current.state.maxPrice).toBe(120000);
    expect(result.current.state.minArea).toBe(60);
    expect(result.current.state.maxArea).toBe(200);
  });

  it('clearing a range bound sets it back to null (unbounded)', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => result.current.setMaxPrice(120000));
    expect(result.current.state.maxPrice).toBe(120000);
    act(() => result.current.setMaxPrice(null));
    expect(result.current.state.maxPrice).toBeNull();
  });

  it('de-dupes district selections at the setter', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => result.current.setDistricts(['Centru', 'Centru', 'Botanica']));
    expect(result.current.state.districts).toEqual(['Centru', 'Botanica']);
  });
});

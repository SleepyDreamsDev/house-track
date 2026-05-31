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

describe('useBrowseFilters — session persistence', () => {
  it('restores values from a previous instance (page switch within a session)', () => {
    const first = renderHook(() => useBrowseFilters());
    act(() => {
      first.result.current.setMinPrice(75000);
      first.result.current.setDistricts(['Buiucani']);
      first.result.current.setType('Villa');
    });
    // A different page mounts a fresh hook instance.
    first.unmount();
    const second = renderHook(() => useBrowseFilters());
    expect(second.result.current.state.minPrice).toBe(75000);
    expect(second.result.current.state.districts).toEqual(['Buiucani']);
    expect(second.result.current.state.type).toBe('Villa');
  });

  it('writes the snapshot to sessionStorage', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => result.current.setRooms('3'));
    const raw = sessionStorage.getItem('house-track:browse-filters');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).rooms).toBe('3');
  });
});

describe('useBrowseFilters — clearAll', () => {
  it('resets every filter to its default and persists the cleared snapshot', () => {
    const { result } = renderHook(() => useBrowseFilters());
    act(() => {
      result.current.setQ('casa');
      result.current.setMinPrice(50000);
      result.current.setDistricts(['Centru']);
      result.current.setType('Villa');
      result.current.setRooms('3');
      result.current.setFavoritesOnly(true);
    });
    act(() => result.current.clearAll());

    const s = result.current.state;
    expect(s.q).toBe('');
    expect(s.minPrice).toBeNull();
    expect(s.districts).toEqual([]);
    expect(s.type).toBe('all');
    expect(s.rooms).toBe('all');
    expect(s.favoritesOnly).toBe(false);

    const snap = JSON.parse(sessionStorage.getItem('house-track:browse-filters')!);
    expect(snap.q).toBe('');
    expect(snap.districts).toEqual([]);
  });
});

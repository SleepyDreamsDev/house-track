import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSortableTable, type Accessors } from '../useSortableTable.js';

interface Row {
  title: string;
  price: number | null;
}

const rows: Row[] = [
  { title: 'Bravo', price: 200 },
  { title: 'Alpha', price: 100 },
  { title: 'Charlie', price: 300 },
];

const accessors: Accessors<Row> = {
  title: (r) => r.title,
  price: (r) => r.price,
};

describe('useSortableTable', () => {
  it('sorts by initial key descending when configured', () => {
    const { result } = renderHook(() =>
      useSortableTable({ rows, accessors, initial: { key: 'price', dir: 'desc' } }),
    );
    expect(result.current.sortedRows.map((r) => r.price)).toEqual([300, 200, 100]);
  });

  it('flips direction when same column is requested again', () => {
    const { result } = renderHook(() =>
      useSortableTable({ rows, accessors, initial: { key: 'price', dir: 'asc' } }),
    );
    act(() => result.current.requestSort('price'));
    expect(result.current.sortDir).toBe('desc');
    expect(result.current.sortedRows.map((r) => r.price)).toEqual([300, 200, 100]);
  });

  it('switches column and defaults to ascending', () => {
    const { result } = renderHook(() =>
      useSortableTable({ rows, accessors, initial: { key: 'price', dir: 'desc' } }),
    );
    act(() => result.current.requestSort('title'));
    expect(result.current.sortKey).toBe('title');
    expect(result.current.sortDir).toBe('asc');
    expect(result.current.sortedRows.map((r) => r.title)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('places nullish values at the end regardless of direction', () => {
    const withNull: Row[] = [
      { title: 'Alpha', price: null },
      { title: 'Bravo', price: 100000 },
    ];
    const { result, rerender } = renderHook(
      ({ dir }: { dir: 'asc' | 'desc' }) =>
        useSortableTable({ rows: withNull, accessors, initial: { key: 'price', dir } }),
      { initialProps: { dir: 'asc' as 'asc' | 'desc' } },
    );
    expect(result.current.sortedRows[0]?.price).toBe(100000);
    expect(result.current.sortedRows[1]?.price).toBeNull();

    rerender({ dir: 'desc' });
    expect(result.current.sortedRows[0]?.price).toBe(100000);
    expect(result.current.sortedRows[1]?.price).toBeNull();
  });

  it('returns rows unchanged when no sort key is active', () => {
    const { result } = renderHook(() => useSortableTable({ rows, accessors, initial: null }));
    expect(result.current.sortedRows).toBe(rows);
    expect(result.current.sortKey).toBeNull();
  });

  it('honors controlled sort and emits onSortChange instead of mutating internal state', () => {
    type Ctrl = { key: string; dir: 'asc' | 'desc' } | null;
    let observed: Ctrl = null;
    const { result, rerender } = renderHook(
      ({ controlled }: { controlled: Ctrl }) =>
        useSortableTable({
          rows,
          accessors,
          controlled,
          onSortChange: (s) => {
            observed = s;
          },
        }),
      { initialProps: { controlled: { key: 'price', dir: 'asc' } as Ctrl } },
    );
    expect(result.current.sortedRows.map((r) => r.price)).toEqual([100, 200, 300]);

    act(() => result.current.requestSort('price'));
    expect(observed).toEqual({ key: 'price', dir: 'desc' });
    // controlled value unchanged until parent updates it
    expect(result.current.sortDir).toBe('asc');

    rerender({ controlled: observed });
    expect(result.current.sortedRows.map((r) => r.price)).toEqual([300, 200, 100]);
  });
});

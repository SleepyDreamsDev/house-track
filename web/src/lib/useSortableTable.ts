import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';
export type SortValue = string | number | null | undefined;
export type Accessor<T> = (row: T) => SortValue;
export type Accessors<T> = Record<string, Accessor<T>>;

export interface SortState {
  key: string;
  dir: SortDir;
}

export interface UseSortableTableOptions<T> {
  rows: T[];
  accessors: Accessors<T>;
  initial?: SortState | null | undefined;
  controlled?: SortState | null | undefined;
  onSortChange?: ((next: SortState) => void) | undefined;
}

export interface UseSortableTableResult<T> {
  sortedRows: T[];
  sortKey: string | null;
  sortDir: SortDir | null;
  requestSort: (key: string) => void;
}

const compare = (a: SortValue, b: SortValue, dir: SortDir): number => {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (typeof a === 'number' && typeof b === 'number') {
    return dir === 'asc' ? a - b : b - a;
  }
  const cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? cmp : -cmp;
};

export function useSortableTable<T>(
  options: UseSortableTableOptions<T>,
): UseSortableTableResult<T> {
  const { rows, accessors, initial = null, controlled, onSortChange } = options;
  const [internal, setInternal] = useState<SortState | null>(initial);
  const sort = controlled !== undefined ? controlled : internal;

  const requestSort = useCallback(
    (key: string) => {
      const next: SortState =
        sort && sort.key === key
          ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: 'asc' };
      if (controlled === undefined) setInternal(next);
      onSortChange?.(next);
    },
    [sort, controlled, onSortChange],
  );

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    const copy = [...rows];
    copy.sort((a, b) => compare(accessor(a), accessor(b), sort.dir));
    return copy;
  }, [rows, accessors, sort]);

  return {
    sortedRows,
    sortKey: sort?.key ?? null,
    sortDir: sort?.dir ?? null,
    requestSort,
  };
}

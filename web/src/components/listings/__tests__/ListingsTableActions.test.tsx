import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ListingsTable, type ListingsTableRow } from '../ListingsTable.js';

const baseRow: ListingsTableRow = {
  id: 'h-1',
  url: 'https://example.test/1',
  title: 'Test House',
  district: 'Buiucani',
  priceEur: 150000,
  areaSqm: 100,
  rooms: 3,
  firstSeenAt: '2025-01-01T00:00:00.000Z',
  watchlist: false,
  excluded: false,
};

describe('ListingsTable action toggles', () => {
  it('renders a favorite toggle and an exclude toggle for a row', () => {
    render(<ListingsTable rows={[baseRow]} />, { wrapper: MemoryRouter });
    const row = screen.getAllByRole('row')[1]!;
    expect(within(row).getByRole('button', { name: /favorite/i })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /exclude/i })).toBeInTheDocument();
  });

  it('clicking the favorite toggle calls onToggleFavorite(id, true) for a non-favorited row and does NOT trigger onRowClick', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    const onRowClick = vi.fn();

    render(
      <ListingsTable
        rows={[{ ...baseRow, watchlist: false }]}
        onToggleFavorite={onToggleFavorite}
        onRowClick={onRowClick}
      />,
      { wrapper: MemoryRouter },
    );

    const favBtn = screen.getByRole('button', { name: /favorite/i });
    await user.click(favBtn);

    expect(onToggleFavorite).toHaveBeenCalledWith('h-1', true);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('clicking the exclude toggle calls onToggleExclude(id, true)', async () => {
    const user = userEvent.setup();
    const onToggleExclude = vi.fn();

    render(
      <ListingsTable rows={[{ ...baseRow, excluded: false }]} onToggleExclude={onToggleExclude} />,
      { wrapper: MemoryRouter },
    );

    const excludeBtn = screen.getByRole('button', { name: /exclude/i });
    await user.click(excludeBtn);

    expect(onToggleExclude).toHaveBeenCalledWith('h-1', true);
  });
});

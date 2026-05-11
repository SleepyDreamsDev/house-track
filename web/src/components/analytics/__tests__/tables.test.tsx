import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BestBuysTable } from '../tables.js';
import type { BestBuyRow } from '../types.js';

const rows: BestBuyRow[] = [
  {
    id: 'a',
    url: 'https://example.test/a',
    title: 'Casă A',
    district: 'Buiucani',
    type: 'casa',
    priceEur: 150000,
    areaSqm: 100,
    yearBuilt: 2010,
    daysOnMkt: 24 * 3,
    eurPerSqm: 1500,
    medianEurPerSqm: 1800,
    discount: 16,
    z: -1.2,
    score: 2.5,
    priceDrop: false,
    dropPct: 0,
    rooms: 3,
  },
  {
    id: 'b',
    url: 'https://example.test/b',
    title: 'Casă B',
    district: 'Botanica',
    type: 'casa',
    priceEur: 80000,
    areaSqm: 60,
    yearBuilt: 2000,
    daysOnMkt: 24 * 10,
    eurPerSqm: 1333,
    medianEurPerSqm: 1500,
    discount: 11,
    z: -0.8,
    score: 1.8,
    priceDrop: true,
    dropPct: 12,
    rooms: 2,
  },
  {
    id: 'c',
    url: 'https://example.test/c',
    title: 'Casă C',
    district: 'Centru',
    type: 'casa',
    priceEur: 220000,
    areaSqm: 110,
    yearBuilt: 2020,
    daysOnMkt: 24 * 1,
    eurPerSqm: 2000,
    medianEurPerSqm: 2200,
    discount: 9,
    z: -0.5,
    score: 2.9,
    priceDrop: false,
    dropPct: 0,
    rooms: 4,
  },
];

describe('BestBuysTable (sortable)', () => {
  it('marks the default sort column (Score) with the descending indicator', () => {
    render(<BestBuysTable rows={rows} fullCols />);
    const scoreHeader = screen.getByRole('button', { name: /Score/ }).closest('th')!;
    expect(scoreHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('clicking the €/m² header sorts the rows ascending', async () => {
    render(<BestBuysTable rows={rows} fullCols />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /€\/m²/ }));
    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((tr) => {
        const tds = within(tr).getAllByRole('cell');
        return tds[5]?.textContent?.trim() ?? '';
      });
    expect(cells).toEqual(['€1333', '€1500', '€2000']);
  });

  it('clicking the Price header twice flips direction', async () => {
    render(<BestBuysTable rows={rows} fullCols />);
    const user = userEvent.setup();
    const priceHeader = screen.getByRole('button', { name: /^Price/ });
    await user.click(priceHeader);
    expect(priceHeader.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    await user.click(priceHeader);
    expect(priceHeader.closest('th')).toHaveAttribute('aria-sort', 'descending');
  });

  it('controlled sort reflects the parent state', async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <BestBuysTable
        rows={rows}
        fullCols
        sort={{ key: 'discount', dir: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    const discountHeader = screen.getByRole('button', { name: /vs median/ }).closest('th')!;
    expect(discountHeader).toHaveAttribute('aria-sort', 'descending');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /€\/m²/ }));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'eurPerSqm', dir: 'asc' });

    rerender(
      <BestBuysTable
        rows={rows}
        fullCols
        sort={{ key: 'eurPerSqm', dir: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    const eurHeader = screen.getByRole('button', { name: /€\/m²/ }).closest('th')!;
    expect(eurHeader).toHaveAttribute('aria-sort', 'ascending');
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListingsTable, type ListingsTableRow } from '../ListingsTable.js';

const rows: ListingsTableRow[] = [
  {
    id: 'h-1',
    url: 'https://example.test/1',
    title: 'Bravo cottage',
    district: 'Buiucani',
    priceEur: 200000,
    areaSqm: 100,
    rooms: 3,
    firstSeenAt: '2025-01-01T00:00:00.000Z',
  },
  {
    id: 'h-2',
    url: 'https://example.test/2',
    title: 'Alpha villa',
    district: 'Botanica',
    priceEur: 100000,
    areaSqm: 80,
    rooms: 2,
    firstSeenAt: '2025-02-01T00:00:00.000Z',
  },
  {
    id: 'h-3',
    url: 'https://example.test/3',
    title: 'Charlie loft',
    district: 'Centru',
    priceEur: 300000,
    areaSqm: 150,
    rooms: 4,
    firstSeenAt: '2025-03-01T00:00:00.000Z',
  },
];

const titles = () =>
  within(screen.getByTestId('listings-table'))
    .getAllByRole('row')
    .slice(1)
    .map((tr) => tr.querySelector('td')?.textContent?.trim() ?? '');

describe('ListingsTable', () => {
  it('renders the expected sortable column headers', () => {
    render(<ListingsTable rows={rows} />);
    for (const label of [
      'Title',
      'District',
      'Price',
      '€/m²',
      'Area',
      'Rooms',
      'Year',
      'First seen',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('clicking the Price header sorts rows ascending then descending on second click', async () => {
    render(<ListingsTable rows={rows} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /Price/ }));
    expect(titles()).toEqual(['Alpha villa', 'Bravo cottage', 'Charlie loft']);

    await user.click(screen.getByRole('button', { name: /Price/ }));
    expect(titles()).toEqual(['Charlie loft', 'Bravo cottage', 'Alpha villa']);
  });

  it('marks the active sort column with the ascending indicator', async () => {
    render(<ListingsTable rows={rows} />);
    const user = userEvent.setup();

    const priceHeader = screen.getByRole('button', { name: /Price/ });
    await user.click(priceHeader);
    const th = priceHeader.closest('th')!;
    expect(th).toHaveAttribute('aria-sort', 'ascending');
  });
});

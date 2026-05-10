import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  AnalyticsFilterRail,
  type AnalyticsFacets,
  type AnalyticsFilterRailProps,
} from '../filters.js';

const baseFacets: AnalyticsFacets = {
  districts: ['Centru', 'Botanica'],
  types: ['House', 'Villa'],
  roomsValues: [3, 4, 5],
  price: { min: 50000, max: 500000 },
};

function makeProps(overrides: Partial<AnalyticsFilterRailProps> = {}): AnalyticsFilterRailProps {
  return {
    q: '',
    setQ: vi.fn(),
    maxPrice: 500000,
    setMaxPrice: vi.fn(),
    districts: [],
    setDistricts: vi.fn(),
    type: 'all',
    setType: vi.fn(),
    rooms: 'all',
    setRooms: vi.fn(),
    facets: baseFacets,
    ...overrides,
  };
}

describe('AnalyticsFilterRail', () => {
  it('renders the same filter controls as Listings (Search, Max price, District) plus type/rooms', () => {
    render(<AnalyticsFilterRail {...makeProps()} />);
    expect(screen.getByLabelText(/Search listings/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Max price/i)).toBeInTheDocument();
    expect(screen.getByText(/^District$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Property type$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Rooms$/i)).toBeInTheDocument();
  });

  it('District options come from facets, not from a hardcoded constant', () => {
    render(<AnalyticsFilterRail {...makeProps()} />);
    const rail = screen.getByTestId('analytics-filter-rail');
    expect(within(rail).getByRole('button', { name: 'Centru' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Botanica' })).toBeInTheDocument();
    // Buiucani is in the OLD A_DISTRICTS constant but not in this facet payload —
    // it must NOT appear, proving the rail is data-driven.
    expect(within(rail).queryByRole('button', { name: 'Buiucani' })).toBeNull();
  });

  it('Property type options come from facets', () => {
    render(<AnalyticsFilterRail {...makeProps()} />);
    const rail = screen.getByTestId('analytics-filter-rail');
    expect(within(rail).getByRole('button', { name: 'House' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Villa' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Townhouse' })).toBeNull();
  });

  it('Rooms options derive from observed roomsValues via roomsBucket', () => {
    render(<AnalyticsFilterRail {...makeProps()} />);
    const rail = screen.getByTestId('analytics-filter-rail');
    // roomsValues=[3,4,5] → buckets '3','4','5+' (no '1–2')
    expect(within(rail).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '5+' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '1–2' })).toBeNull();
  });

  it('Search input invokes setQ on type', async () => {
    const setQ = vi.fn();
    render(<AnalyticsFilterRail {...makeProps({ setQ })} />);
    await userEvent.type(screen.getByLabelText(/Search listings/i), 'Centru');
    expect(setQ).toHaveBeenCalled();
  });

  it('Max price slider invokes setMaxPrice on change', () => {
    const setMaxPrice = vi.fn();
    render(<AnalyticsFilterRail {...makeProps({ setMaxPrice })} />);
    const slider = screen.getByLabelText(/Max price/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '200000' } });
    expect(setMaxPrice).toHaveBeenCalledWith(200000);
  });

  it('renders without throwing when facets are undefined (loading state)', () => {
    render(<AnalyticsFilterRail {...makeProps({ facets: undefined })} />);
    expect(screen.getByTestId('analytics-filter-rail')).toBeInTheDocument();
    // Districts/types/rooms have no options to render but the labels still exist.
    expect(screen.getByText(/^District$/i)).toBeInTheDocument();
  });

  it('renders the extraSlot (used for the Period selector on Price Drops)', () => {
    render(
      <AnalyticsFilterRail
        {...makeProps()}
        extraSlot={<div data-testid="period-slot">period</div>}
      />,
    );
    expect(screen.getByTestId('period-slot')).toBeInTheDocument();
  });
});

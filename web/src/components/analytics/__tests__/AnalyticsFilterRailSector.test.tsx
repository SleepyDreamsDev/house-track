import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  AnalyticsFilterRail,
  type AnalyticsFacets,
  type AnalyticsFilterRailProps,
} from '../filters.js';

const baseFacets: AnalyticsFacets = {
  districts: ['Centru', 'Botanica'],
  types: ['House'],
  roomsValues: [3],
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
    sectors: [],
    setSectors: vi.fn(),
    type: 'all',
    setType: vi.fn(),
    rooms: 'all',
    setRooms: vi.fn(),
    facets: baseFacets,
    ...overrides,
  };
}

describe('AnalyticsFilterRail — Sector multi-select', () => {
  it('renders a Sector group with options when facets include sectors', () => {
    const facetsWithSectors: AnalyticsFacets = {
      ...baseFacets,
      sectors: [
        { name: 'Centru', count: 5 },
        { name: 'Botanica', count: 3 },
      ],
    };
    render(<AnalyticsFilterRail {...makeProps({ facets: facetsWithSectors })} />);
    const rail = screen.getByTestId('analytics-filter-rail');
    const sectorLabel = within(rail).getByText(/^Sector$/i);
    expect(sectorLabel).toBeInTheDocument();
    // Centru appears in both District and Sector groups — confirm at least one button
    // with that name exists (getAllByRole avoids the duplicate-match error).
    const centruButtons = within(rail).getAllByRole('button', { name: 'Centru' });
    expect(centruButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders no Sector group when facets have no sectors', () => {
    render(<AnalyticsFilterRail {...makeProps({ facets: baseFacets })} />);
    const rail = screen.getByTestId('analytics-filter-rail');
    expect(within(rail).queryByText(/^Sector$/i)).toBeNull();
  });
});

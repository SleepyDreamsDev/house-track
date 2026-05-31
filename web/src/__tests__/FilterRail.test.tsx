import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  FilterRail,
  type FilterFacets,
  type FilterRailProps,
} from '../components/filters/FilterRail.js';

// The shared rail is presentational: it takes facets + value/setter pairs and
// renders only the groups that have backing data. "Hide if no data in current
// view" lives here, driven by the facets payload.

const FULL_FACETS: FilterFacets = {
  districts: ['Centru', 'Botanica'],
  sectors: [{ name: 'Centru', count: 5 }],
  types: ['House', 'Villa'],
  roomsValues: [1, 2, 3, 4, 5],
  price: { min: 50000, max: 200000 },
  areaSqm: { min: 30, max: 300 },
  landAre: { min: 1, max: 50 },
  floors: { min: 1, max: 4 },
  favoritesCount: 4,
  excludedCount: 2,
  mislabeledCount: 3,
};

function baseProps(overrides: Partial<FilterRailProps> = {}): FilterRailProps {
  return {
    q: '',
    setQ: vi.fn(),
    minPrice: null,
    maxPrice: null,
    setMinPrice: vi.fn(),
    setMaxPrice: vi.fn(),
    minArea: null,
    maxArea: null,
    setMinArea: vi.fn(),
    setMaxArea: vi.fn(),
    minLand: null,
    maxLand: null,
    setMinLand: vi.fn(),
    setMaxLand: vi.fn(),
    minFloors: null,
    maxFloors: null,
    setMinFloors: vi.fn(),
    setMaxFloors: vi.fn(),
    districts: [],
    setDistricts: vi.fn(),
    sectors: [],
    setSectors: vi.fn(),
    type: 'all',
    setType: vi.fn(),
    rooms: 'all',
    setRooms: vi.fn(),
    favoritesOnly: false,
    setFavoritesOnly: vi.fn(),
    showExcluded: false,
    setShowExcluded: vi.fn(),
    facets: FULL_FACETS,
    ...overrides,
  };
}

function renderRail(opts: { facets?: FilterFacets; withMislabeled?: boolean } = {}) {
  render(
    <FilterRail
      {...baseProps({
        facets: opts.facets ?? FULL_FACETS,
        ...(opts.withMislabeled ? { hideMislabeled: false, setHideMislabeled: vi.fn() } : {}),
      })}
    />,
  );
}

describe('FilterRail — group visibility', () => {
  it('renders every group when all facets have data (Listings context)', () => {
    renderRail({ withMislabeled: true });
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.getByText('Price (€)')).toBeInTheDocument();
    expect(screen.getByLabelText('Price min')).toBeInTheDocument();
    expect(screen.getByLabelText('Price max')).toBeInTheDocument();
    expect(screen.getByText('Surface area (m²)')).toBeInTheDocument();
    expect(screen.getByLabelText('Surface area min')).toBeInTheDocument();
    expect(screen.getByText('Land area (ar)')).toBeInTheDocument();
    expect(screen.getByLabelText('Land area max')).toBeInTheDocument();
    expect(screen.getByText('Floors')).toBeInTheDocument();
    expect(screen.getByLabelText('Floors min')).toBeInTheDocument();
    expect(screen.getByText('Locality')).toBeInTheDocument();
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByText('Property type')).toBeInTheDocument();
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByLabelText('Favorites only')).toBeInTheDocument();
    expect(screen.getByLabelText('Show excluded')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide mislabeled')).toBeInTheDocument();
  });

  it('hides Price when its bounds are a single value (min === max)', () => {
    renderRail({ facets: { ...FULL_FACETS, price: { min: 100000, max: 100000 } } });
    expect(screen.queryByText('Price (€)')).not.toBeInTheDocument();
  });

  it('hides Surface area when the facet has no area bounds', () => {
    const { areaSqm: _omit, ...noArea } = FULL_FACETS;
    renderRail({ facets: noArea });
    expect(screen.queryByText('Surface area (m²)')).not.toBeInTheDocument();
  });

  it('hides Locality when there are no districts', () => {
    renderRail({ facets: { ...FULL_FACETS, districts: [] } });
    expect(screen.queryByText('Locality')).not.toBeInTheDocument();
  });

  it('hides Sector when there are no sectors', () => {
    renderRail({ facets: { ...FULL_FACETS, sectors: [] } });
    expect(screen.queryByText('Sector')).not.toBeInTheDocument();
  });

  it('hides Property type when one or zero types exist', () => {
    renderRail({ facets: { ...FULL_FACETS, types: ['House'] } });
    expect(screen.queryByText('Property type')).not.toBeInTheDocument();
  });

  it('hides Rooms when no rooms buckets are backed by data', () => {
    renderRail({ facets: { ...FULL_FACETS, roomsValues: [] } });
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument();
  });

  it('hides Favorites only when favoritesCount is 0', () => {
    renderRail({ facets: { ...FULL_FACETS, favoritesCount: 0 } });
    expect(screen.queryByLabelText('Favorites only')).not.toBeInTheDocument();
  });

  it('hides Show excluded when excludedCount is 0', () => {
    renderRail({ facets: { ...FULL_FACETS, excludedCount: 0 } });
    expect(screen.queryByLabelText('Show excluded')).not.toBeInTheDocument();
  });

  it('always renders Search even when every other facet is empty', () => {
    renderRail({
      facets: {
        districts: [],
        sectors: [],
        types: [],
        roomsValues: [],
        price: { min: null, max: null },
        favoritesCount: 0,
        excludedCount: 0,
        mislabeledCount: 0,
      },
    });
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.queryByText('Price (€)')).not.toBeInTheDocument();
  });
});

describe('FilterRail — Hide mislabeled is Listings-only', () => {
  it('shows Hide mislabeled when the props are provided and data exists', () => {
    renderRail({ withMislabeled: true });
    expect(screen.getByLabelText('Hide mislabeled')).toBeInTheDocument();
  });

  it('omits Hide mislabeled when the props are absent (Analytics context)', () => {
    renderRail({ withMislabeled: false });
    expect(screen.queryByLabelText('Hide mislabeled')).not.toBeInTheDocument();
  });

  it('omits Hide mislabeled when props are provided but mislabeledCount is 0', () => {
    renderRail({ withMislabeled: true, facets: { ...FULL_FACETS, mislabeledCount: 0 } });
    expect(screen.queryByLabelText('Hide mislabeled')).not.toBeInTheDocument();
  });
});

describe('FilterRail — options sourcing and handlers', () => {
  const facets: FilterFacets = {
    districts: ['Centru', 'Botanica'],
    types: ['House', 'Villa'],
    roomsValues: [3, 4, 5],
    price: { min: 50000, max: 500000 },
    areaSqm: { min: 40, max: 400 },
  };

  it('District options are data-driven from facets', () => {
    render(<FilterRail {...baseProps({ facets })} />);
    const rail = screen.getByTestId('filter-rail');
    expect(within(rail).getByRole('button', { name: 'Centru' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Botanica' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Buiucani' })).toBeNull();
  });

  it('Property type options are data-driven from facets', () => {
    render(<FilterRail {...baseProps({ facets })} />);
    const rail = screen.getByTestId('filter-rail');
    expect(within(rail).getByRole('button', { name: 'House' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Villa' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Townhouse' })).toBeNull();
  });

  it('Rooms options derive from observed roomsValues via roomsBucket', () => {
    render(<FilterRail {...baseProps({ facets })} />);
    const rail = screen.getByTestId('filter-rail');
    // roomsValues=[3,4,5] → buckets '3','4','5+' (no '1–2')
    expect(within(rail).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '5+' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '1–2' })).toBeNull();
  });

  it('Search input invokes setQ on type', async () => {
    const setQ = vi.fn();
    render(<FilterRail {...baseProps({ facets, setQ })} />);
    await userEvent.type(screen.getByLabelText('Search listings'), 'Centru');
    expect(setQ).toHaveBeenCalled();
  });

  it('Price max input invokes setMaxPrice with the parsed number', () => {
    const setMaxPrice = vi.fn();
    render(<FilterRail {...baseProps({ facets, setMaxPrice })} />);
    fireEvent.change(screen.getByLabelText('Price max'), { target: { value: '120000' } });
    expect(setMaxPrice).toHaveBeenCalledWith(120000);
  });

  it('clearing the Price max input invokes setMaxPrice(null)', () => {
    const setMaxPrice = vi.fn();
    render(<FilterRail {...baseProps({ facets, maxPrice: 120000, setMaxPrice })} />);
    fireEvent.change(screen.getByLabelText('Price max'), { target: { value: '' } });
    expect(setMaxPrice).toHaveBeenCalledWith(null);
  });

  it('Surface area min input invokes setMinArea', () => {
    const setMinArea = vi.fn();
    render(<FilterRail {...baseProps({ facets, setMinArea })} />);
    fireEvent.change(screen.getByLabelText('Surface area min'), { target: { value: '80' } });
    expect(setMinArea).toHaveBeenCalledWith(80);
  });

  it('renders without throwing when facets are undefined (loading state)', () => {
    render(<FilterRail {...baseProps({ facets: undefined })} />);
    expect(screen.getByTestId('filter-rail')).toBeInTheDocument();
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.queryByText('Locality')).not.toBeInTheDocument();
    expect(screen.queryByText('Price (€)')).not.toBeInTheDocument();
  });

  it('renders the extraSlot (used for the Period selector on Price Drops)', () => {
    render(<FilterRail {...baseProps({ facets, extraSlot: <div data-testid="period-slot" /> })} />);
    expect(screen.getByTestId('period-slot')).toBeInTheDocument();
  });

  it('renders a Sector group scoped by testid when facets include sectors', () => {
    render(
      <FilterRail
        {...baseProps({
          facets: {
            ...facets,
            sectors: [
              { name: 'Centru', count: 5 },
              { name: 'Botanica', count: 3 },
            ],
          },
        })}
      />,
    );
    const sector = within(screen.getByTestId('sector-filter'));
    expect(sector.getByText('Sector')).toBeInTheDocument();
    expect(sector.getByRole('button', { name: 'Centru' })).toBeInTheDocument();
  });

  it('renders a Chișinău (municipality) group button that selects all member districts', () => {
    const setDistricts = vi.fn();
    render(
      <FilterRail
        {...baseProps({
          setDistricts,
          facets: {
            ...facets,
            districts: ['Chișinău', 'Codru', 'Bălți'],
            municipality: ['Chișinău', 'Codru'],
          },
        })}
      />,
    );
    const rail = within(screen.getByTestId('filter-rail'));
    fireEvent.click(rail.getByRole('button', { name: 'Chișinău (municipality)' }));
    expect(setDistricts).toHaveBeenCalledWith(['Chișinău', 'Codru']);
  });

  it('does not render the municipality group when facets omit it', () => {
    render(<FilterRail {...baseProps({ facets })} />);
    expect(
      within(screen.getByTestId('filter-rail')).queryByRole('button', {
        name: 'Chișinău (municipality)',
      }),
    ).toBeNull();
  });

  it('negative range input does not propagate a negative value', () => {
    const setMinPrice = vi.fn();
    render(<FilterRail {...baseProps({ facets, setMinPrice })} />);
    fireEvent.change(screen.getByLabelText('Price min'), { target: { value: '-5' } });
    expect(setMinPrice).not.toHaveBeenCalledWith(-5);
  });

  it('shows Clear all only when a filter is active and invokes onClearAll', () => {
    const onClearAll = vi.fn();
    // No active filters → button hidden even with the handler present.
    const { rerender } = render(<FilterRail {...baseProps({ facets, onClearAll })} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();

    // A set district makes filters active → button appears.
    rerender(<FilterRail {...baseProps({ facets, onClearAll, districts: ['Centru'] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('omits Clear all when no onClearAll handler is provided', () => {
    render(<FilterRail {...baseProps({ facets, districts: ['Centru'] })} />);
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });
});

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
  favoritesCount: 4,
  excludedCount: 2,
  mislabeledCount: 3,
};

function renderRail(
  opts: {
    facets?: FilterFacets;
    withMislabeled?: boolean;
  } = {},
) {
  const props = {
    q: '',
    setQ: vi.fn(),
    maxPrice: 200000,
    setMaxPrice: vi.fn(),
    districts: [] as string[],
    setDistricts: vi.fn(),
    sectors: [] as string[],
    setSectors: vi.fn(),
    type: 'all',
    setType: vi.fn(),
    rooms: 'all',
    setRooms: vi.fn(),
    favoritesOnly: false,
    setFavoritesOnly: vi.fn(),
    showExcluded: false,
    setShowExcluded: vi.fn(),
    facets: opts.facets ?? FULL_FACETS,
    ...(opts.withMislabeled ? { hideMislabeled: false, setHideMislabeled: vi.fn() } : {}),
  };
  render(<FilterRail {...props} />);
}

describe('FilterRail — group visibility', () => {
  it('renders every group when all facets have data (Listings context)', () => {
    renderRail({ withMislabeled: true });
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.getByText('Max price')).toBeInTheDocument();
    expect(screen.getByText('District')).toBeInTheDocument();
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByText('Property type')).toBeInTheDocument();
    expect(screen.getByText('Rooms')).toBeInTheDocument();
    expect(screen.getByLabelText('Favorites only')).toBeInTheDocument();
    expect(screen.getByLabelText('Show excluded')).toBeInTheDocument();
    expect(screen.getByLabelText('Hide mislabeled')).toBeInTheDocument();
  });

  it('hides Max price when min equals max', () => {
    renderRail({ facets: { ...FULL_FACETS, price: { min: 100000, max: 100000 } } });
    expect(screen.queryByText('Max price')).not.toBeInTheDocument();
  });

  it('hides District when there are no districts', () => {
    renderRail({ facets: { ...FULL_FACETS, districts: [] } });
    expect(screen.queryByText('District')).not.toBeInTheDocument();
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

// Options sourcing + handler wiring (migrated from the old AnalyticsFilterRail
// tests when that component was promoted to the shared FilterRail).
function makeProps(overrides: Partial<FilterRailProps> = {}): FilterRailProps {
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
    favoritesOnly: false,
    setFavoritesOnly: vi.fn(),
    showExcluded: false,
    setShowExcluded: vi.fn(),
    facets: {
      districts: ['Centru', 'Botanica'],
      types: ['House', 'Villa'],
      roomsValues: [3, 4, 5],
      price: { min: 50000, max: 500000 },
    },
    ...overrides,
  };
}

describe('FilterRail — options sourcing and handlers', () => {
  it('District options are data-driven from facets', () => {
    render(<FilterRail {...makeProps()} />);
    const rail = screen.getByTestId('filter-rail');
    expect(within(rail).getByRole('button', { name: 'Centru' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Botanica' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Buiucani' })).toBeNull();
  });

  it('Property type options are data-driven from facets', () => {
    render(<FilterRail {...makeProps()} />);
    const rail = screen.getByTestId('filter-rail');
    expect(within(rail).getByRole('button', { name: 'House' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Villa' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: 'Townhouse' })).toBeNull();
  });

  it('Rooms options derive from observed roomsValues via roomsBucket', () => {
    render(<FilterRail {...makeProps()} />);
    const rail = screen.getByTestId('filter-rail');
    // roomsValues=[3,4,5] → buckets '3','4','5+' (no '1–2')
    expect(within(rail).getByRole('button', { name: '3' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '4' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: '5+' })).toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: '1–2' })).toBeNull();
  });

  it('Search input invokes setQ on type', async () => {
    const setQ = vi.fn();
    render(<FilterRail {...makeProps({ setQ })} />);
    await userEvent.type(screen.getByLabelText('Search listings'), 'Centru');
    expect(setQ).toHaveBeenCalled();
  });

  it('Max price slider invokes setMaxPrice on change', () => {
    const setMaxPrice = vi.fn();
    render(<FilterRail {...makeProps({ setMaxPrice })} />);
    fireEvent.change(screen.getByLabelText('Max price'), { target: { value: '200000' } });
    expect(setMaxPrice).toHaveBeenCalledWith(200000);
  });

  it('renders without throwing when facets are undefined (loading state)', () => {
    render(<FilterRail {...makeProps({ facets: undefined })} />);
    expect(screen.getByTestId('filter-rail')).toBeInTheDocument();
    // No facet data → only Search shows; option groups are gated out.
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.queryByText('District')).not.toBeInTheDocument();
  });

  it('renders the extraSlot (used for the Period selector on Price Drops)', () => {
    render(
      <FilterRail {...makeProps({ extraSlot: <div data-testid="period-slot">period</div> })} />,
    );
    expect(screen.getByTestId('period-slot')).toBeInTheDocument();
  });

  it('renders a Sector group scoped by testid when facets include sectors', () => {
    render(
      <FilterRail
        {...makeProps({
          facets: {
            districts: ['Centru', 'Botanica'],
            types: ['House'],
            roomsValues: [3],
            price: { min: 50000, max: 500000 },
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
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Listings } from '../pages/Listings.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderListings(qc: QueryClient, initialPath = '/') {
  const router = createMemoryRouter([{ path: '/', element: <Listings /> }], {
    initialEntries: [initialPath],
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const listingA = {
  id: 'h-1',
  url: 'https://example.test/1',
  title: 'Test House',
  priceEur: 150000,
  areaSqm: 100,
  rooms: 3,
  district: 'Buiucani',
  firstSeenAt: new Date().toISOString(),
  watchlist: false,
  excluded: false,
};

describe('Listings favorite / exclude mutations', () => {
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = makeQueryClient();
  });

  async function switchToTable(user: ReturnType<typeof userEvent.setup>) {
    const tableTab = await screen.findByRole('tab', { name: 'Table' });
    await user.click(tableTab);
    await screen.findByTestId('listings-table');
  }

  it('clicking a row favorite toggle issues PUT /api/listings/:id/watchlist with { watchlist: true } and refetches', async () => {
    const user = userEvent.setup();
    const { apiCall } = await import('../lib/api.js');
    let callCount = 0;
    (apiCall as ReturnType<typeof vi.fn>).mockImplementation((endpoint: string) => {
      callCount++;
      if (typeof endpoint === 'string' && endpoint.includes('/watchlist')) {
        return Promise.resolve({ id: 'h-1', watchlist: true });
      }
      return Promise.resolve({ listings: [listingA], total: 1 });
    });

    renderListings(qc);
    await switchToTable(user);

    const initialCallCount = callCount;
    const favBtn = await screen.findByRole('button', { name: /favorite/i });
    await user.click(favBtn);

    expect(apiCall).toHaveBeenCalledWith('/listings/h-1/watchlist', {
      method: 'PUT',
      body: JSON.stringify({ watchlist: true }),
    });
    expect(callCount).toBeGreaterThan(initialCallCount + 1);
  });

  it('clicking a row exclude toggle issues PUT /api/listings/:id/excluded with { excluded: true } and refetches', async () => {
    const user = userEvent.setup();
    const { apiCall } = await import('../lib/api.js');
    let callCount = 0;
    (apiCall as ReturnType<typeof vi.fn>).mockImplementation((endpoint: string) => {
      callCount++;
      if (typeof endpoint === 'string' && endpoint.includes('/excluded')) {
        return Promise.resolve({ id: 'h-1', excluded: true });
      }
      return Promise.resolve({ listings: [listingA], total: 1 });
    });

    renderListings(qc);
    await switchToTable(user);

    const initialCallCount = callCount;
    const excludeBtn = await screen.findByRole('button', { name: /exclude/i });
    await user.click(excludeBtn);

    expect(apiCall).toHaveBeenCalledWith('/listings/h-1/excluded', {
      method: 'PUT',
      body: JSON.stringify({ excluded: true }),
    });
    expect(callCount).toBeGreaterThan(initialCallCount + 1);
  });

  it('toggling "Show excluded" adds includeExcluded=true to the listings request', async () => {
    const user = userEvent.setup();
    const { apiCall } = await import('../lib/api.js');
    (apiCall as ReturnType<typeof vi.fn>).mockResolvedValue({ listings: [], total: 0 });

    renderListings(qc);
    await screen.findByText('Listings');

    const showExcludedToggle = screen.getByRole('checkbox', { name: /show excluded/i });
    await user.click(showExcludedToggle);

    const calls = (apiCall as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    const lastListingCall = [...calls]
      .reverse()
      .find(([ep]) => typeof ep === 'string' && ep.startsWith('/listings?'));
    expect(lastListingCall?.[0]).toContain('includeExcluded=true');
  });

  it('toggling "Favorites only" adds favorite=true to the listings request', async () => {
    const user = userEvent.setup();
    const { apiCall } = await import('../lib/api.js');
    (apiCall as ReturnType<typeof vi.fn>).mockResolvedValue({ listings: [], total: 0 });

    renderListings(qc);
    await screen.findByText('Listings');

    const favOnlyToggle = screen.getByRole('checkbox', { name: /favorites only/i });
    await user.click(favOnlyToggle);

    const calls = (apiCall as ReturnType<typeof vi.fn>).mock.calls as [string, ...unknown[]][];
    const lastListingCall = [...calls]
      .reverse()
      .find(([ep]) => typeof ep === 'string' && ep.startsWith('/listings?'));
    expect(lastListingCall?.[0]).toContain('favorite=true');
  });
});

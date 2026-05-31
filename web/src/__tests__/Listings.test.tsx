import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Listings } from '../pages/Listings.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

describe('Listings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders the Listings page with the shared filter rail', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 1,
          districts: ['Centru'],
          price: { min: 50000, max: 200000 },
          rooms: { min: 1, max: 5 },
          areaSqm: { min: 30, max: 200 },
          types: [],
          roomsValues: [],
        });
      }
      return Promise.resolve({ listings: [], total: 0 });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Listings' })).toBeInTheDocument();
    expect(await screen.findByText('Price (€)')).toBeInTheDocument();
    expect(screen.getByLabelText('Search listings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Title, district…')).toBeInTheDocument();
    // District appears once facets load (rail) and as a table column header.
    expect(screen.getAllByText('District').length).toBeGreaterThan(0);
  });

  it('renders the sort segmented control', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByText('Price ↑')).toBeInTheDocument();
    expect(screen.getByText('€/m² ↑')).toBeInTheDocument();
  });

  it('exposes a Cards/Table view toggle with Table selected by default', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const cardsTab = await screen.findByRole('tab', { name: 'Cards' });
    const tableTab = screen.getByRole('tab', { name: 'Table' });
    expect(tableTab).toHaveAttribute('aria-selected', 'true');
    expect(cardsTab).toHaveAttribute('aria-selected', 'false');
  });

  it('switching to Table view renders the sortable listings table', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({
      listings: [
        {
          id: 'h-1',
          url: 'https://example.test/1',
          title: 'Casă Buiucani',
          priceEur: 150000,
          areaSqm: 110,
          rooms: 3,
          district: 'Buiucani',
          firstSeenAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Table' }));
    expect(await screen.findByTestId('listings-table')).toBeInTheDocument();
    expect(screen.getByText('Casă Buiucani')).toBeInTheDocument();
  });

  it('renders listing cards from API data', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({
      listings: [
        {
          id: 'h-1',
          title: 'Casă, 130 m², Buiucani',
          priceEur: 145000,
          areaSqm: 130,
          rooms: 4,
          district: 'Buiucani',
          firstSeenAt: new Date().toISOString(),
        },
      ],
      total: 1,
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Casă, 130 m², Buiucani')).toBeInTheDocument();
  });

  it('shows mislabel badges for a flagged listing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 1,
          districts: ['Ialoveni'],
          price: {},
          rooms: {},
          areaSqm: {},
        });
      }
      return Promise.resolve({
        listings: [
          {
            id: '1',
            url: 'https://999.md/ro/1',
            title: 'Casă tip duplex',
            district: 'Ialoveni',
            priceEur: 100000,
            areaSqm: 100,
            rooms: 3,
            firstSeenAt: new Date().toISOString(),
            derivedType: 'Duplex',
            typeMismatch: true,
            regionMismatch: true,
            mismatchReasons: ['type: duplex', 'region: Ialoveni'],
          },
        ],
        total: 1,
      });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Duplex')).toBeInTheDocument();
    expect(await screen.findByText(/Out-of-region/)).toBeInTheDocument();
  });

  it('hides flagged listings when the hide toggle is on', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 2,
          districts: [],
          price: {},
          rooms: {},
          areaSqm: {},
          mislabeledCount: 1,
        });
      }
      return Promise.resolve({
        listings: [
          {
            id: '1',
            url: 'u1',
            title: 'Casă bună',
            district: 'Durlești',
            priceEur: 90000,
            areaSqm: 90,
            rooms: 3,
            firstSeenAt: new Date().toISOString(),
            derivedType: 'House',
            typeMismatch: false,
            regionMismatch: false,
            mismatchReasons: [],
          },
          {
            id: '2',
            url: 'u2',
            title: 'Casă duplex',
            district: 'Durlești',
            priceEur: 95000,
            areaSqm: 95,
            rooms: 3,
            firstSeenAt: new Date().toISOString(),
            derivedType: 'Duplex',
            typeMismatch: true,
            regionMismatch: false,
            mismatchReasons: ['type: duplex'],
          },
        ],
        total: 2,
      });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    expect(await screen.findByText('Casă duplex')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Hide mislabeled'));
    expect(screen.queryByText('Casă duplex')).not.toBeInTheDocument();
    expect(screen.getByText('Casă bună')).toBeInTheDocument();
  });

  it('expanding a table row shows its price history', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.includes('/price-history')) {
        return Promise.resolve({
          points: [
            {
              priceEur: 50_000,
              capturedAt: '2026-05-10T10:00:00Z',
              deltaPct: null,
              direction: 'baseline',
            },
            {
              priceEur: 48_000,
              capturedAt: '2026-05-20T10:00:00Z',
              deltaPct: -4.0,
              direction: 'down',
            },
          ],
        });
      }
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 1,
          districts: ['Centru'],
          price: { min: 0, max: 0 },
          rooms: { min: 1, max: 5 },
          areaSqm: { min: 30, max: 200 },
          types: [],
          roomsValues: [],
        });
      }
      return Promise.resolve({
        listings: [
          {
            id: 'h-1',
            url: 'https://example.test/1',
            title: 'Row one',
            priceEur: 48_000,
            areaSqm: 50,
            rooms: 3,
            district: 'Centru',
            firstSeenAt: '2026-05-01T10:00:00Z',
          },
        ],
        total: 1,
      });
    });

    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const row = await screen.findByText('Row one');
    await user.click(row);

    const panel = await screen.findByTestId('price-history-panel');
    expect(panel).toBeInTheDocument();
    expect(await within(panel).findByText('€48,000')).toBeInTheDocument();
    expect(within(panel).getByText(/-4\.0%/)).toBeInTheDocument();
  });

  it('expanding a card shows its price history', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.includes('/price-history')) {
        return Promise.resolve({
          points: [
            {
              priceEur: 50_000,
              capturedAt: '2026-05-10T10:00:00Z',
              deltaPct: null,
              direction: 'baseline',
            },
            {
              priceEur: 48_000,
              capturedAt: '2026-05-20T10:00:00Z',
              deltaPct: -4.0,
              direction: 'down',
            },
          ],
        });
      }
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({
          total: 1,
          districts: ['Centru'],
          price: { min: 0, max: 0 },
          rooms: { min: 1, max: 5 },
          areaSqm: { min: 30, max: 200 },
          types: [],
          roomsValues: [],
        });
      }
      return Promise.resolve({
        listings: [
          {
            id: 'h-1',
            url: 'https://example.test/1',
            title: 'Card one',
            priceEur: 48_000,
            areaSqm: 50,
            rooms: 3,
            district: 'Centru',
            firstSeenAt: '2026-05-01T10:00:00Z',
          },
        ],
        total: 1,
      });
    });

    const user = userEvent.setup();
    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('tab', { name: 'Cards' }));
    await user.click(await screen.findByText('Card one'));

    const panel = await screen.findByTestId('price-history-panel');
    expect(panel).toBeInTheDocument();
    expect(await within(panel).findByText('€48,000')).toBeInTheDocument();
    expect(within(panel).getByText(/-4\.0%/)).toBeInTheDocument();
  });

  it('shows a Back to Best buys link when arriving with ?from=best-buys', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }], {
      initialEntries: ['/?from=best-buys&highlight=abc'],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const back = await screen.findByRole('link', { name: /Back to Best buys/ });
    expect(back).toHaveAttribute('href', '/analytics?tab=best-buys');
  });

  it('omits the Back link in the normal (non-best-buys) entry', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('link', { name: /Back to Best buys/ })).toBeNull();
  });
});

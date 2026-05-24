import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('renders the redesigned Houses page with filter rail', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Houses')).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Max price')).toBeInTheDocument();
    expect(screen.getByText('District')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Title, district…')).toBeInTheDocument();
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
        return Promise.resolve({ total: 2, districts: [], price: {}, rooms: {}, areaSqm: {} });
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
});

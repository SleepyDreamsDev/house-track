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

  it('exposes a Cards/Table view toggle with Cards selected by default', async () => {
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
    expect(cardsTab).toHaveAttribute('aria-selected', 'true');
    expect(tableTab).toHaveAttribute('aria-selected', 'false');
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
});

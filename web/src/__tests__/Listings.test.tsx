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
  });

  it('renders listings table with data', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({
      listings: [
        {
          id: '1',
          title: 'Apartment A',
          priceEur: 150000,
          areaSqm: 50,
          rooms: 2,
          district: 'Downtown',
          firstSeenAt: '2024-05-01T00:00:00Z',
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

    expect(screen.getByText('Listings')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter max price...')).toBeInTheDocument();
  });

  it('renders pagination controls', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 50 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Previous')).toBeInTheDocument();
    expect(screen.getByText('Next')).toBeInTheDocument();
  });

  it('renders filter input', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({ listings: [], total: 0 });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Max Price (EUR)')).toBeInTheDocument();
  });
});

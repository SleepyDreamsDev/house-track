import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Listings } from '../pages/Listings.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

describe('Listings — sector multi-select', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('shows a Sector label and Centru button when facets include sectors', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((url: string) => {
      if (url === '/listings/facets') {
        return Promise.resolve({
          total: 1,
          districts: ['Centru'],
          sectors: [{ name: 'Centru', count: 5 }],
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

    // The Sector label appears after facets load
    expect(await screen.findByText('Sector')).toBeInTheDocument();
    // The sector option button is present, scoped to the Sector block
    // (a "Centru" button also exists in the Districts section).
    const sectorBlock = within(screen.getByTestId('sector-filter'));
    expect(sectorBlock.getByRole('button', { name: 'Centru' })).toBeInTheDocument();
  });

  it('does not show Sector block when facets return no sectors', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((url: string) => {
      if (url === '/listings/facets') {
        return Promise.resolve({
          total: 0,
          districts: [],
          price: { min: null, max: null },
          rooms: { min: null, max: null },
          areaSqm: { min: null, max: null },
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

    // Wait for listings to settle, then confirm Sector is absent. "District"
    // now matches both the filter-rail label and the table column header
    // (table is the default view), so tolerate multiple matches here.
    await screen.findAllByText('District');
    expect(screen.queryByText('Sector')).not.toBeInTheDocument();
  });
});

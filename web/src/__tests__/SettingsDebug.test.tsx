import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

import { Settings } from '../pages/Settings.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({ apiCall: vi.fn() }));

function renderSettings() {
  const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Settings — seller-field debug check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders the Debug section with a check button', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]); // settings + sources

    renderSettings();

    expect(screen.getByText('Seller-field population check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run check' })).toBeInTheDocument();
  });

  it('shows populated sellers after clicking Run check', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) =>
      Promise.resolve(
        endpoint === '/analytics/sellers'
          ? [
              {
                authorId: 'ag1',
                authorName: 'osea',
                listings: 4,
                activeListings: 3,
                sellThrough: 0.25,
              },
            ]
          : [],
      ),
    );

    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));

    await waitFor(() => expect(screen.getByText(/1 seller populating/)).toBeInTheDocument());
    expect(screen.getByText(/osea — 4 listings, 25% sell-through/)).toBeInTheDocument();
  });

  it('reports the empty state when no seller identity is populated yet', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]); // sellers + settings + sources all empty

    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Run check' }));

    await waitFor(() =>
      expect(screen.getByText(/author identity not populated yet/)).toBeInTheDocument(),
    );
  });
});

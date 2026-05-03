import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Sweeps } from '../pages/Sweeps.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

function mockBy(handlers: Record<string, unknown>) {
  return async (path: string) => {
    for (const prefix of Object.keys(handlers)) {
      if (path.startsWith(prefix)) return handlers[prefix];
    }
    return [];
  };
}

describe('Sweeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders the redesigned page header and table columns', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(
      mockBy({
        '/sweeps': [
          {
            id: 1,
            startedAt: new Date().toISOString(),
            durationMs: 5000,
            status: 'success',
            pagesFetched: 10,
            detailsFetched: 30,
            newListings: 5,
            updatedListings: 2,
            errorCount: 0,
          },
        ],
        '/circuit': { open: false },
      }),
    );

    const router = createMemoryRouter([{ path: '/', element: <Sweeps /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Sweeps')).toBeInTheDocument();
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Pages')).toBeInTheDocument();
  });

  it('shows the circuit-breaker banner with reset button when circuit is open', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(
      mockBy({ '/sweeps': [], '/circuit': { open: true, openedAt: new Date().toISOString() } }),
    );

    const router = createMemoryRouter([{ path: '/', element: <Sweeps /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Reset breaker')).toBeInTheDocument();
    expect(screen.getByText('crawler paused')).toBeInTheDocument();
  });
});

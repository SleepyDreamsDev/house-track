import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('Run sweep now button POSTs to /sweeps and navigates to the new sweep', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/sweeps' && opts?.method === 'POST') {
        return { id: 42, startedAt: new Date().toISOString() };
      }
      if (path.startsWith('/sweeps')) return [];
      if (path === '/circuit') return { open: false };
      return [];
    });

    const router = createMemoryRouter([
      { path: '/', element: <Sweeps /> },
      { path: '/sweeps/:id', element: <div>SweepDetail 42</div> },
    ]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const button = await screen.findByRole('button', { name: /Run sweep now/i });
    fireEvent.click(button);

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/sweeps', { method: 'POST' });
    });
    expect(await screen.findByText('SweepDetail 42')).toBeInTheDocument();
  });

  it('Run smoke button POSTs to /sweeps/smoke and navigates to the new sweep', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/sweeps/smoke' && opts?.method === 'POST') {
        return { id: 7, startedAt: new Date().toISOString() };
      }
      if (path.startsWith('/sweeps')) return [];
      if (path === '/circuit') return { open: false };
      return [];
    });

    const router = createMemoryRouter([
      { path: '/', element: <Sweeps /> },
      { path: '/sweeps/:id', element: <div>SweepDetail 7</div> },
    ]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Run smoke/i }));

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/sweeps/smoke', { method: 'POST' });
    });
    expect(await screen.findByText('SweepDetail 7')).toBeInTheDocument();
  });

  it('Run sweep now button is disabled when the circuit is open', async () => {
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

    // Wait for both the circuit query to land and the button's disabled
    // attribute to reflect it — otherwise we race the React Query resolution.
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Run sweep now/i });
      expect(btn).toBeDisabled();
    });
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

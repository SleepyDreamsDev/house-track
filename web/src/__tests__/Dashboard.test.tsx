import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Dashboard } from '../pages/Dashboard.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the redesigned KPI strip and side widgets', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Active listings')).toBeInTheDocument();
    expect(screen.getAllByText('New today').length).toBeGreaterThan(0);
    expect(screen.getByText('Avg price')).toBeInTheDocument();
    expect(screen.getByText('Sweep success')).toBeInTheDocument();
    expect(screen.getByText('Crawler health')).toBeInTheDocument();
    expect(screen.getByText('By district')).toBeInTheDocument();
  });

  it('exposes Grafana action and run-sweep button', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Open Grafana')).toBeInTheDocument();
    expect(screen.getByText('Run sweep now')).toBeInTheDocument();
  });

  it('navigates to /listings when "View all houses →" button is clicked', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/sweeps/latest')
        return Promise.resolve({
          status: 'success',
          durationMs: 1000,
          startedAt: new Date().toISOString(),
        });
      if (endpoint === '/circuit') return Promise.resolve({ open: false });
      if (endpoint === '/stats/success-rate')
        return Promise.resolve({ rate: 1, ok: 1, total: 1, window: 24 });
      if (endpoint === '/stats/avg-price') return Promise.resolve({ avgPrice: 0, count: 0 });
      if (endpoint === '/settings') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    const router = createMemoryRouter(
      [
        { path: '/', element: <Dashboard /> },
        { path: '/listings', element: <div>LISTINGS_STUB</div> },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /view all houses/i }));

    expect(await screen.findByText('LISTINGS_STUB')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/listings');
  });

  it('renders title even while queries are pending', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });
});

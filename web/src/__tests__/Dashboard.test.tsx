import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('does not show a Run sweep button on the dashboard', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (path: string) => {
      if (path === '/sweeps/latest') return { startedAt: new Date().toISOString() };
      if (path === '/circuit') return { open: false };
      if (path === '/stats/success-rate') return { rate: 1, n: 1 };
      if (path === '/stats/avg-price') return { avgPrice: 0, count: 0 };
      return [];
    });

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Run sweep now')).not.toBeInTheDocument();
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

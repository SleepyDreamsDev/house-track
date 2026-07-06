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
    // Shared singleton queryClient — clear between tests so one test's resolved
    // data can't leak into the next (which mocks different endpoint shapes).
    queryClient.clear();
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

  const renderDashboard = () => {
    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  };

  const mockWithLatestSweep = async (latest: unknown) => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (path: string) => {
      if (path === '/sweeps/latest') return latest;
      if (path === '/circuit') return { open: false };
      if (path === '/stats/success-rate') return { rate: 1, ok: 1, total: 1, window: 1 };
      if (path === '/stats/avg-price') return { avgPrice: 0, count: 0 };
      return [];
    });
  };

  it('Dashboard warns when sweep data is stale', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await mockWithLatestSweep({
      status: 'success',
      durationMs: 1000,
      startedAt: twoDaysAgo,
      finishedAt: twoDaysAgo,
    });

    renderDashboard();

    expect(await screen.findByText(/data may be stale/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sweeps/i })).toHaveAttribute('href', '/sweeps');
  });

  it('Dashboard shows a failure banner when the latest sweep failed', async () => {
    const now = new Date().toISOString();
    await mockWithLatestSweep({
      status: 'failed',
      durationMs: 1000,
      startedAt: now,
      finishedAt: now,
    });

    renderDashboard();

    expect(await screen.findByText(/last sweep failed/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sweeps/i })).toHaveAttribute('href', '/sweeps');
  });

  it('No staleness banner on fresh, running, or empty sweep state', async () => {
    // Fresh success
    const now = new Date().toISOString();
    await mockWithLatestSweep({
      status: 'success',
      durationMs: 1000,
      startedAt: now,
      finishedAt: now,
    });
    renderDashboard();
    expect(await screen.findByText('Crawler health')).toBeInTheDocument();
    expect(screen.queryByText(/data may be stale/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/last sweep failed/i)).not.toBeInTheDocument();
  });

  it('No staleness banner while a recently-started sweep is running', async () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    await mockWithLatestSweep({
      status: 'running',
      durationMs: 0,
      startedAt: tenMinAgo,
      finishedAt: null,
    });
    renderDashboard();
    expect(await screen.findByText('Crawler health')).toBeInTheDocument();
    expect(screen.queryByText(/data may be stale/i)).not.toBeInTheDocument();
  });

  it('A zombie running sweep does not suppress the staleness banner', async () => {
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    await mockWithLatestSweep({
      status: 'running',
      durationMs: 0,
      startedAt: twoDaysAgo,
      finishedAt: null,
    });
    renderDashboard();
    expect(await screen.findByText(/data may be stale/i)).toBeInTheDocument();
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

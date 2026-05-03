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

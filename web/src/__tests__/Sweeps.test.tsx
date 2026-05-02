import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Sweeps } from '../pages/Sweeps.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

describe('Sweeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sweeps table', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([
      {
        id: 'sweep-1',
        startedAt: '2024-05-02T10:00:00Z',
        durationMs: 5000,
        status: 'success',
        pagesFetched: 10,
        newListings: 5,
        errorCount: 0,
      },
    ]);

    const router = createMemoryRouter([{ path: '/', element: <Sweeps /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Sweeps')).toBeInTheDocument();
  });

  it('shows Reset Circuit Breaker button', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Sweeps /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Reset Circuit Breaker')).toBeInTheDocument();
  });

  it('renders table headers', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Sweeps /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});

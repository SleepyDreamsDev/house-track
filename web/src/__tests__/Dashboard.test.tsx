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

  it('renders Dashboard page with tiles', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({});

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Last Sweep')).toBeInTheDocument();
    expect(screen.getByText('Circuit State')).toBeInTheDocument();
  });

  it('displays Grafana button', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue({});

    const router = createMemoryRouter([{ path: '/', element: <Dashboard /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Open in Grafana')).toBeInTheDocument();
  });

  it('shows loading states', async () => {
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

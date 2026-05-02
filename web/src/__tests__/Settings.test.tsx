import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Settings } from '../pages/Settings.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Settings page with three sections', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Crawler Tuning')).toBeInTheDocument();
    expect(screen.getByText('Sources')).toBeInTheDocument();
    expect(screen.getByText('Global Filter')).toBeInTheDocument();
  });

  it('displays settings form', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue([]);

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Configure search filters for listings')).toBeInTheDocument();
  });

  it('renders settings with loading state', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Crawler Tuning')).toBeInTheDocument();
  });
});

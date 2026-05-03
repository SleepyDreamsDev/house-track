import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Settings } from '../pages/Settings.js';
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

describe('Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders the redesigned settings header and Sources section', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockBy({ '/settings': [], '/sources': [] }));

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(
      screen.getByText('Runtime overrides applied at the start of each sweep'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Sources').length).toBeGreaterThan(0);
  });

  it('renders setting groups using the metadata returned by the API', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(
      mockBy({
        '/settings': [
          {
            key: 'politeness.baseDelayMs',
            value: 8000,
            default: 8000,
            group: 'Politeness',
            kind: 'number',
            unit: 'ms',
          },
          {
            key: 'log.level',
            value: 'info',
            default: 'info',
            group: 'Logging',
            kind: 'select',
            options: ['debug', 'info', 'warn', 'error'],
          },
        ],
        '/sources': [],
      }),
    );

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect((await screen.findAllByText('Politeness')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Logging').length).toBeGreaterThan(0);
    expect(screen.getByText('politeness.baseDelayMs')).toBeInTheDocument();
  });

  it('renders title even while queries are pending', async () => {
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

    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

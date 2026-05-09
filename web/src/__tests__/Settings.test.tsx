import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('Toggling an enabled source disables it via PATCH /api/sources/:id', async () => {
    const { apiCall } = await import('../lib/api.js');
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    (apiCall as any).mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path === '/settings') return [];
      if (path === '/sources') {
        return [
          {
            id: 1,
            name: '999.md',
            baseUrl: 'https://999.md',
            enabled: true,
            placeholder: false,
          },
        ];
      }
      return {};
    });

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { pressed: true });
    fireEvent.click(toggle);

    await waitFor(() => {
      const patch = calls.find((c) => c.path === '/sources/1' && c.init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch!.init!.body).toBe(JSON.stringify({ enabled: false }));
    });
  });

  it('Toggling a disabled source enables it via PATCH /api/sources/:id', async () => {
    const { apiCall } = await import('../lib/api.js');
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    (apiCall as any).mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path === '/settings') return [];
      if (path === '/sources') {
        return [
          {
            id: 7,
            name: '999.md',
            baseUrl: 'https://999.md',
            enabled: false,
            placeholder: false,
          },
        ];
      }
      return {};
    });

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { pressed: false });
    fireEvent.click(toggle);

    await waitFor(() => {
      const patch = calls.find((c) => c.path === '/sources/7' && c.init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch!.init!.body).toBe(JSON.stringify({ enabled: true }));
    });
  });

  it('Toggling invalidates the [sources] query on success', async () => {
    const { apiCall } = await import('../lib/api.js');
    let sourcesFetches = 0;
    (apiCall as any).mockImplementation(async (path: string) => {
      if (path === '/settings') return [];
      if (path === '/sources') {
        sourcesFetches += 1;
        return [
          {
            id: 1,
            name: '999.md',
            baseUrl: 'https://999.md',
            enabled: true,
            placeholder: false,
          },
        ];
      }
      return {};
    });

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { pressed: true });
    const before = sourcesFetches;
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(sourcesFetches).toBeGreaterThan(before);
    });
  });

  it('Placeholder sources cannot be toggled', async () => {
    const { apiCall } = await import('../lib/api.js');
    const calls: Array<{ path: string; init: RequestInit | undefined }> = [];
    (apiCall as any).mockImplementation(async (path: string, init?: RequestInit) => {
      calls.push({ path, init });
      if (path === '/settings') return [];
      if (path === '/sources') {
        return [
          {
            id: 5,
            name: 'lara.md',
            baseUrl: 'https://lara.md',
            enabled: false,
            placeholder: true,
          },
        ];
      }
      return {};
    });

    const router = createMemoryRouter([{ path: '/', element: <Settings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const toggle = await screen.findByRole('button', { pressed: false });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);

    await new Promise((r) => setTimeout(r, 20));
    const patch = calls.find((c) => c.init?.method === 'PATCH');
    expect(patch).toBeUndefined();
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

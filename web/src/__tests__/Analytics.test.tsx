import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { AppShell } from '../components/layout/AppShell.js';
import { Analytics } from '../pages/Analytics.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

const renderAnalytics = () => {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [{ path: 'analytics', element: <Analytics /> }],
      },
    ],
    { initialEntries: ['/analytics'] },
  );
  return render(
    <QueryClientProvider client={makeClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

const emptyOverview = {
  kpis: {
    medianEurPerSqm: 0,
    activeInventory: 0,
    medianDomDays: 0,
    bestDealsCount: 0,
    recentDropsCount: 0,
  },
  trendByDistrict: {},
  months: [],
  heatmap: {},
  domBuckets: [],
  inventory12w: [],
  newPerWeek: [],
  gonePerWeek: [],
  scatter: [],
};

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Sidebar exposes the Analytics nav item in the right order', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue(emptyOverview);

    renderAnalytics();

    const nav = screen.getByRole('navigation');
    const links = within(nav).getAllByRole('link');
    const labels = links.map((l) => l.textContent?.trim());
    expect(labels).toEqual(['Dashboard', 'Listings', 'Sweeps', 'Filter', 'Analytics', 'Settings']);

    const analyticsLink = within(nav).getByRole('link', { name: 'Analytics' });
    expect(analyticsLink).toHaveAttribute('href', '/analytics');
  });

  it('Analytics page renders the header and three tabs with Overview selected', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockResolvedValue(emptyOverview);

    renderAnalytics();

    expect(screen.getByRole('heading', { name: /Analytics/i })).toBeInTheDocument();
    const tablist = screen.getByRole('tablist');
    expect(within(tablist).getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Best buys/i })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Price drops/i })).toBeInTheDocument();
    expect(within(tablist).getByRole('tab', { name: /Overview/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Tab switching swaps panels without route change', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/analytics/overview') return Promise.resolve(emptyOverview);
      return Promise.resolve([]);
    });

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <AppShell />,
          children: [{ path: 'analytics', element: <Analytics /> }],
        },
      ],
      { initialEntries: ['/analytics'] },
    );
    render(
      <QueryClientProvider client={makeClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const user = userEvent.setup();
    const bestBuysTab = screen.getByRole('tab', { name: /Best buys/i });
    await user.click(bestBuysTab);

    expect(router.state.location.pathname).toBe('/analytics');
    expect(screen.getByRole('tab', { name: /Best buys/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Overview/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tabpanel', { name: /Best buys/i })).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel', { name: /Overview/i })).toBeNull();
  });

  it('Page tolerates pending queries without crashing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(() => new Promise(() => {}));

    renderAnalytics();

    expect(screen.getByRole('heading', { name: /Analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Best buys/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Price drops/i })).toBeInTheDocument();
  });

  it('Empty arrays render KPI tiles and chart headers without throwing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/analytics/overview') return Promise.resolve(emptyOverview);
      return Promise.resolve([]);
    });

    renderAnalytics();

    expect(await screen.findByText(/Median €\/m²/i)).toBeInTheDocument();
    expect(screen.getByText(/Active inventory/i)).toBeInTheDocument();
    expect(screen.getByText(/Median DOM/i)).toBeInTheDocument();
    expect(screen.getByText(/Best deals/i)).toBeInTheDocument();
    expect(screen.getByText(/Recent drops/i)).toBeInTheDocument();
  });

  it('Calls the three analytics endpoints (overview eagerly, others on tab switch)', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/analytics/overview') return Promise.resolve(emptyOverview);
      return Promise.resolve([]);
    });

    renderAnalytics();

    await screen.findByText(/Median €\/m²/i);
    expect(apiCall).toHaveBeenCalledWith('/analytics/overview');

    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Best buys/i }));
    await screen.findByRole('tabpanel', { name: /Best buys/i });
    expect(apiCall).toHaveBeenCalledWith('/analytics/best-buys');

    await user.click(screen.getByRole('tab', { name: /Price drops/i }));
    await screen.findByRole('tabpanel', { name: /Price drops/i });
    expect(apiCall).toHaveBeenCalledWith('/analytics/price-drops?period=30d');
  });
});

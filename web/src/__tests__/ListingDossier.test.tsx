import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { ListingDossier } from '../pages/ListingDossier.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

const makeClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });

const listing = {
  id: 'l1',
  url: 'https://999.md/l1',
  title: 'Casă în Centru',
  priceEur: 250000,
  priceRaw: '250000 EUR',
  rooms: 4,
  areaSqm: 125,
  landAre: 4,
  district: 'Centru',
  street: 'Str. Test',
  floors: 2,
  yearBuilt: 2005,
  heatingType: 'autonoma',
  description: 'O casă frumoasă.',
  imageUrls: [],
  primaryImage: null,
  active: true,
  watchlist: false,
  excluded: false,
  firstSeenAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  lastFetchedAt: new Date().toISOString(),
  filterValuesEnrichedAt: null,
  filterValues: [],
};

const dossier = {
  activeDOM: 60,
  domMedianDistrict: 25,
  hedonic: { predictedEur: 192000, residualPct: 0.3 },
  postedAt: null,
  bumpedAt: null,
  authorName: 'Agenția X',
  authorListings: [
    {
      id: 'a2',
      url: 'https://999.md/a2',
      title: 'Altă casă',
      priceEur: 120000,
      active: true,
      delistedAt: null,
    },
  ],
  cluster: {
    canonicalId: 'l1',
    members: [
      {
        id: 'old1',
        url: 'https://999.md/old1',
        title: 'Aceeași casă, anunț vechi',
        priceEur: 280000,
        active: false,
        delistedAt: new Date().toISOString(),
        firstSeenAt: new Date().toISOString(),
      },
    ],
  },
};

const renderDossier = (id = 'l1') => {
  const router = createMemoryRouter([{ path: '/listings/:id', element: <ListingDossier /> }], {
    initialEntries: [`/listings/${id}`],
  });
  render(
    <QueryClientProvider client={makeClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
};

describe('ListingDossier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Dossier page renders the negotiation context for one listing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/listings/l1') return Promise.resolve(listing);
      if (endpoint === '/listings/l1/dossier') return Promise.resolve(dossier);
      if (endpoint === '/listings/l1/price-history') return Promise.resolve({ points: [] });
      return Promise.reject(new Error(`unexpected ${endpoint}`));
    });

    renderDossier();

    expect(await screen.findByText('Casă în Centru')).toBeInTheDocument();
    // KStat tiles.
    expect(screen.getByText(/days on market/i)).toBeInTheDocument();
    expect(screen.getByText('60d')).toBeInTheDocument();
    expect(screen.getByText(/vs 25d median/i)).toBeInTheDocument();
    expect(screen.getByText('+30%')).toBeInTheDocument();
    // External link to 999.md.
    expect(screen.getByRole('link', { name: /999\.md/i })).toHaveAttribute(
      'href',
      'https://999.md/l1',
    );
    // Price history panel is mounted (self-fetching).
    expect(screen.getByTestId('price-history-panel')).toBeInTheDocument();
    // Same seller card.
    expect(screen.getByText(/same seller/i)).toBeInTheDocument();
    expect(screen.getByText('Altă casă')).toBeInTheDocument();
    // Duplicates / relists card with dossier link.
    expect(screen.getByText(/duplicates \/ relists/i)).toBeInTheDocument();
    const sibling = screen.getByRole('link', { name: /Aceeași casă, anunț vechi/i });
    expect(sibling).toHaveAttribute('href', '/listings/old1');
  });

  it('Dossier renders em dash when hedonic is null', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint === '/listings/l1') return Promise.resolve(listing);
      if (endpoint === '/listings/l1/dossier')
        return Promise.resolve({
          ...dossier,
          hedonic: null,
          authorListings: [],
          cluster: null,
        });
      if (endpoint === '/listings/l1/price-history') return Promise.resolve({ points: [] });
      return Promise.reject(new Error(`unexpected ${endpoint}`));
    });

    renderDossier();

    expect(await screen.findByText('Casă în Centru')).toBeInTheDocument();
    expect(screen.getByText(/vs model/i)).toBeInTheDocument();
    expect(screen.queryByText(/same seller/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/duplicates \/ relists/i)).not.toBeInTheDocument();
  });

  it('Dossier page handles an unknown listing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockRejectedValue(new Error('404'));

    renderDossier('nope');

    expect(await screen.findByText(/listing not found/i)).toBeInTheDocument();
  });
});

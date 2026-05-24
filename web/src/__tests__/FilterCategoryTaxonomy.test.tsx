import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Filter } from '../pages/Filter.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

// Universal filters present in BOTH house and apartment taxonomies
const SHARED_FILTERS = [
  {
    filterId: 16,
    label: 'Tip ofertă',
    kind: 'options',
    features: [
      {
        featureId: 1,
        label: 'Tip ofertă',
        options: [
          { id: 776, label: 'Vânzare' },
          { id: 777, label: 'Chirie' },
        ],
      },
    ],
  },
  {
    filterId: 32,
    label: 'Regiune',
    kind: 'options',
    features: [
      {
        featureId: 7,
        label: 'Raion',
        options: [{ id: 12900, label: 'mun. Chișinău' }],
      },
    ],
  },
  {
    filterId: 9441,
    label: 'Preț',
    kind: 'range',
    features: [{ featureId: 2, label: 'Preț', unit: 'UNIT_EUR' }],
  },
];

// House-only filter (land area — not in apartments)
const HOUSE_ONLY_FILTER = {
  filterId: 1200,
  label: 'Suprafață teren',
  kind: 'range',
  features: [{ featureId: 300, label: 'Suprafață teren', unit: 'UNIT_METER_SQUARE' }],
};

// Apartment-only filter (floor — not in houses)
const APARTMENT_ONLY_FILTER = {
  filterId: 2200,
  label: 'Etaj',
  kind: 'range',
  features: [{ featureId: 400, label: 'Etaj' }],
};

const HOUSE_TAXONOMY = [...SHARED_FILTERS, HOUSE_ONLY_FILTER];
const APARTMENT_TAXONOMY = [...SHARED_FILTERS, APARTMENT_ONLY_FILTER];

const BASE_FILTER_RESPONSE = {
  sources: [{ slug: '999md', name: '999.md', active: true }],
  resolved: {
    searchInput: { subCategoryId: 1406, filters: [] },
    postFilter: { maxPriceEur: 250000 },
  },
  sourceSlug: '999md',
};

// Filter response with house category and a house-only selection that
// will become incompatible when switching to apartment
const HOUSE_FILTER_RESPONSE = {
  ...BASE_FILTER_RESPONSE,
  generic: {
    category: 'house',
    filters: [
      // Universal — should survive category switch
      { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
      { kind: 'options', filterId: 32, featureId: 7, optionIds: [12900] },
      { kind: 'range', filterId: 9441, featureId: 2, min: '50000' },
      // House-only — should be dropped when switching to apartment
      { kind: 'range', filterId: 1200, featureId: 300, min: '100' },
    ],
  },
};

function buildMockApi(overrides?: { filter?: unknown }) {
  return async (endpoint: string) => {
    if (endpoint === '/filter/taxonomy?category=house') return HOUSE_TAXONOMY;
    if (endpoint === '/filter/taxonomy?category=apartment') return APARTMENT_TAXONOMY;
    // Legacy endpoint (no param) — return house taxonomy for backward compat
    if (endpoint === '/filter/taxonomy') return HOUSE_TAXONOMY;
    if (endpoint === '/filter') return overrides?.filter ?? HOUSE_FILTER_RESPONSE;
    if (endpoint === '/filters') return [];
    return null;
  };
}

function renderFilter() {
  const router = createMemoryRouter([{ path: '/', element: <Filter /> }]);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Filter page — category-aware taxonomy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('fetches taxonomy keyed on draft category (house → /filter/taxonomy?category=house)', async () => {
    const { apiCall } = await import('../lib/api.js');
    const calls: string[] = [];
    (apiCall as any).mockImplementation(async (endpoint: string) => {
      calls.push(endpoint);
      return buildMockApi()(endpoint);
    });

    renderFilter();

    // Wait for form to render
    await screen.findByText('Tip ofertă');

    // Should have fetched taxonomy with house param
    expect(calls).toContain('/filter/taxonomy?category=house');
  });

  it('switching category refetches taxonomy with the new category param', async () => {
    const { apiCall } = await import('../lib/api.js');
    const calls: string[] = [];
    (apiCall as any).mockImplementation(async (endpoint: string) => {
      calls.push(endpoint);
      return buildMockApi()(endpoint);
    });

    renderFilter();
    await screen.findByText('Tip ofertă');

    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    await waitFor(() => {
      expect(calls).toContain('/filter/taxonomy?category=apartment');
    });
  });

  it('switching to apartment shows apartment-only filter and hides house-only filter', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(buildMockApi());

    renderFilter();
    await screen.findByText('Suprafață teren'); // house-only visible

    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    // Apartment-only filter should appear
    await screen.findByText('Etaj');

    // House-only filter should disappear
    expect(screen.queryByText('Suprafață teren')).not.toBeInTheDocument();
  });

  it('universal filters (offer-type 16, region 32, price 9441) remain after category switch', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(buildMockApi());

    renderFilter();
    await screen.findByText('Tip ofertă');

    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    await screen.findByText('Etaj');
    expect(screen.getByText('Tip ofertă')).toBeInTheDocument();
    expect(screen.getByText('Regiune')).toBeInTheDocument();
    expect(screen.getByText('Preț')).toBeInTheDocument();
  });

  it('drops incompatible selections on category switch (house-only filterId removed from draft)', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return HOUSE_FILTER_RESPONSE;
      }
      return buildMockApi()(endpoint);
    });

    renderFilter();
    await screen.findByText('Tip ofertă');

    // Switch to apartment — this should reconcile selections
    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    await screen.findByText('Etaj');

    // Save and inspect the payload
    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    const body = putBody as { generic: { filters: Array<{ filterId: number }> } };
    // House-only filterId 1200 must NOT appear
    const houseOnly = body.generic.filters.find((f) => f.filterId === 1200);
    expect(houseOnly).toBeUndefined();
    // Universal filters must survive
    const offerType = body.generic.filters.find((f) => f.filterId === 16);
    expect(offerType).toBeDefined();
    const region = body.generic.filters.find((f) => f.filterId === 32);
    expect(region).toBeDefined();
    const price = body.generic.filters.find((f) => f.filterId === 9441);
    expect(price).toBeDefined();
  });

  it('shows a notice when selections were dropped due to category switch', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(buildMockApi());

    renderFilter();
    await screen.findByText('Tip ofertă');

    // Start: house with a house-only selection (filterId 1200)
    // Switch to apartment — that selection should be dropped, notice shown
    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    await screen.findByText('Etaj');

    // Notice should mention dropped count and new category
    expect(await screen.findByText(/1 filter.* not available for apartment/i)).toBeInTheDocument();
  });

  it('no notice shown if no selections were dropped on category switch', async () => {
    const { apiCall } = await import('../lib/api.js');
    // Start with no house-only selections — only universals
    const filterWithNoHouseOnly = {
      ...HOUSE_FILTER_RESPONSE,
      generic: {
        category: 'house',
        filters: [
          { kind: 'options', filterId: 16, featureId: 1, optionIds: [776] },
          { kind: 'range', filterId: 9441, featureId: 2, min: '50000' },
        ],
      },
    };
    (apiCall as any).mockImplementation(buildMockApi({ filter: filterWithNoHouseOnly }));

    renderFilter();
    await screen.findByText('Tip ofertă');

    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    await screen.findByText('Etaj');

    // No "not available" notice should appear
    expect(screen.queryByText(/filter.* not available/i)).not.toBeInTheDocument();
  });
});

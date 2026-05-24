import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { Filter } from '../pages/Filter.js';
import { queryClient } from '../lib/query.js';

vi.mock('../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

const TAXONOMY = [
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
        options: [
          { id: 12900, label: 'mun. Chișinău' },
          { id: 12901, label: 'Anenii Noi' },
        ],
      },
    ],
  },
  {
    filterId: 9441,
    label: 'Preț',
    kind: 'range',
    features: [
      {
        featureId: 2,
        label: 'Preț',
        unit: 'UNIT_EUR',
      },
    ],
  },
  {
    filterId: 1073,
    label: 'Suprafață totală',
    kind: 'range',
    features: [
      {
        featureId: 244,
        label: 'Suprafață totală',
        unit: 'UNIT_METER_SQUARE',
      },
    ],
  },
  {
    filterId: 4132,
    label: 'Facilități',
    kind: 'boolean',
    features: [
      { featureId: 100, label: 'Garaj' },
      { featureId: 101, label: 'Piscină' },
    ],
  },
];

const FILTER_RESPONSE = {
  generic: {
    category: 'house',
    filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }],
  },
  sources: [{ slug: '999md', name: '999.md', active: true }],
  resolved: {
    searchInput: { subCategoryId: 1406, filters: [] },
    postFilter: { maxPriceEur: 250000 },
  },
  sourceSlug: '999md',
};

function mockApi(overrides?: Record<string, unknown>) {
  return async (endpoint: string) => {
    if (endpoint === '/filter/taxonomy') return TAXONOMY;
    if (endpoint === '/filter') return overrides?.filter ?? FILTER_RESPONSE;
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

describe('Filter page — taxonomy-driven form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders a collapsible group for each taxonomy filter', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // Each taxonomy entry should appear as a section label
    expect(await screen.findByText('Tip ofertă')).toBeInTheDocument();
    expect(screen.getByText('Regiune')).toBeInTheDocument();
    expect(screen.getByText('Preț')).toBeInTheDocument();
    expect(screen.getByText('Suprafață totală')).toBeInTheDocument();
    expect(screen.getByText('Facilități')).toBeInTheDocument();
  });

  it('renders option chips for an options-kind filter', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // Expand the Tip ofertă group to see options
    const summary = await screen.findByText('Tip ofertă');
    await userEvent.click(summary);

    expect(await screen.findByRole('button', { name: 'Vânzare' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Chirie' })).toBeInTheDocument();
  });

  it('renders min/max inputs for a range-kind filter', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // Expand the Preț group
    const summary = await screen.findByText('Preț');
    await userEvent.click(summary);

    // Use getAllByPlaceholderText since multiple range filters may render inputs
    expect((await screen.findAllByPlaceholderText('min')).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('max').length).toBeGreaterThan(0);
  });

  it('renders toggle chips for a boolean-kind filter', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // Expand the Facilități group
    const summary = await screen.findByText('Facilități');
    await userEvent.click(summary);

    expect(await screen.findByRole('button', { name: 'Garaj' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Piscină' })).toBeInTheDocument();
  });

  it('shows selected-count badge when a filter has selections', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // filterId:16 is pre-selected with 1 optionId in FILTER_RESPONSE
    // Badge should appear for Tip ofertă
    expect(await screen.findByText('1')).toBeInTheDocument();
  });

  it('opens a section by default when it has a selection', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    // Vânzare is pre-selected (filterId 16, featureId 1, optionId 776)
    // It should be visible without clicking because section defaults open
    expect(await screen.findByRole('button', { name: 'Vânzare' })).toBeInTheDocument();
  });

  it('toggling an option updates the draft (PUT body has correct FilterSelection shape)', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return FILTER_RESPONSE;
      }
      return mockApi()(endpoint);
    });

    renderFilter();

    // Chirie chip should appear once Tip ofertă is expanded (auto-open since pre-selected)
    const chirie = await screen.findByRole('button', { name: 'Chirie' });
    await userEvent.click(chirie);

    // Now click Save
    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    expect(putBody).toMatchObject({
      generic: {
        category: 'house',
        filters: expect.arrayContaining([
          expect.objectContaining({
            kind: 'options',
            filterId: 16,
            featureId: 1,
            optionIds: expect.arrayContaining([776, 777]),
          }),
        ]),
      },
    });
  });

  it('de-selecting the only option in a filter removes the FilterSelection from PUT body', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return FILTER_RESPONSE;
      }
      return mockApi()(endpoint);
    });

    renderFilter();

    // Deselect the pre-selected Vânzare chip
    const vanzare = await screen.findByRole('button', { name: 'Vânzare' });
    await userEvent.click(vanzare);

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    const body = putBody as { generic: { filters: unknown[] } };
    const tipOferta = body.generic.filters.find((f: any) => f.filterId === 16 && f.featureId === 1);
    expect(tipOferta).toBeUndefined();
  });

  it('filling range inputs updates PUT body with string min/max', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    // Use a taxonomy with only the area range filter to avoid ambiguous inputs
    const areaTaxonomy = [
      {
        filterId: 1073,
        label: 'Suprafață totală',
        kind: 'range',
        features: [{ featureId: 244, label: 'Suprafață totală', unit: 'UNIT_METER_SQUARE' }],
      },
    ];
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return FILTER_RESPONSE;
      }
      if (endpoint === '/filter/taxonomy') return areaTaxonomy;
      if (endpoint === '/filter')
        return { ...FILTER_RESPONSE, generic: { category: 'house', filters: [] } };
      return [];
    });

    renderFilter();

    // Expand Suprafață group (no selection → collapsed by default)
    const areaLabel = await screen.findByText('Suprafață totală');
    await userEvent.click(areaLabel);

    const minInput = await screen.findByPlaceholderText('min');
    const maxInput = screen.getByPlaceholderText('max');
    await userEvent.clear(minInput);
    await userEvent.type(minInput, '80');
    await userEvent.clear(maxInput);
    await userEvent.type(maxInput, '200');

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    expect(putBody).toMatchObject({
      generic: {
        filters: expect.arrayContaining([
          {
            kind: 'range',
            filterId: 1073,
            featureId: 244,
            unit: 'UNIT_METER_SQUARE',
            min: '80',
            max: '200',
          },
        ]),
      },
    });
  });

  it('toggling a boolean feature adds a boolean FilterSelection to PUT body', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return FILTER_RESPONSE;
      }
      return mockApi()(endpoint);
    });

    renderFilter();

    const facilitatiLabel = await screen.findByText('Facilități');
    await userEvent.click(facilitatiLabel);

    const garaj = await screen.findByRole('button', { name: 'Garaj' });
    await userEvent.click(garaj);

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    expect(putBody).toMatchObject({
      generic: {
        filters: expect.arrayContaining([{ kind: 'boolean', filterId: 4132, featureId: 100 }]),
      },
    });
  });

  it('category select updates the PUT body category field', async () => {
    const { apiCall } = await import('../lib/api.js');
    let putBody: unknown = null;
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        putBody = JSON.parse(opts.body as string);
        return FILTER_RESPONSE;
      }
      return mockApi()(endpoint);
    });

    renderFilter();

    await screen.findByText('Tip ofertă');

    const categorySelect = screen.getByRole('combobox', { name: /category/i });
    await userEvent.selectOptions(categorySelect, 'apartment');

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    await waitFor(() => expect(putBody).not.toBeNull());

    expect(putBody).toMatchObject({
      generic: { category: 'apartment' },
    });
  });

  it('shows 400 error details inline when save returns a validation error', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') {
        throw new Error('API error: 400 Bad Request');
      }
      return mockApi()(endpoint);
    });

    renderFilter();

    await screen.findByText('Tip ofertă');

    const save = screen.getByRole('button', { name: 'Save' });
    // Make the form dirty first by toggling something
    const chirie = await screen.findByRole('button', { name: 'Chirie' });
    await userEvent.click(chirie);
    await userEvent.click(save);

    expect(await screen.findByText(/API error/)).toBeInTheDocument();
  });

  it('shows "next sweep will use this" after a successful save', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(async (endpoint: string, opts?: RequestInit) => {
      if (opts?.method === 'PUT') return FILTER_RESPONSE;
      return mockApi()(endpoint);
    });

    renderFilter();

    await screen.findByText('Tip ofertă');
    const chirie = await screen.findByRole('button', { name: 'Chirie' });
    await userEvent.click(chirie);

    const save = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(save);

    expect(await screen.findByText(/next sweep will use this/i)).toBeInTheDocument();
  });

  it('Reset button reverts draft to saved state', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    await screen.findByText('Tip ofertă');
    const chirie = await screen.findByRole('button', { name: 'Chirie' });
    await userEvent.click(chirie);

    // Save button should be enabled (dirty)
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();

    // Reset
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    // Should no longer be dirty
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows loading state while taxonomy is pending', async () => {
    const { apiCall } = await import('../lib/api.js');
    // Never resolves
    (apiCall as any).mockImplementation(() => new Promise(() => {}));

    renderFilter();

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('keeps the Source and Resolved sections', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation(mockApi());

    renderFilter();

    await screen.findByText('Tip ofertă');

    // Source section heading (h2) and Resolved section heading should both exist
    expect(screen.getAllByText('Source').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Resolved/).length).toBeGreaterThan(0);
  });

  it('long option list with >10 options shows a search input', async () => {
    const { apiCall } = await import('../lib/api.js');
    const manyOptions = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      label: `Option ${i + 1}`,
    }));
    const bigTaxonomy = [
      {
        filterId: 999,
        label: 'Big List',
        kind: 'options',
        features: [{ featureId: 50, label: 'Big Feature', options: manyOptions }],
      },
    ];
    (apiCall as any).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/filter/taxonomy') return bigTaxonomy;
      if (endpoint === '/filter')
        return { ...FILTER_RESPONSE, generic: { category: 'house', filters: [] } };
      return [];
    });

    renderFilter();

    const summary = await screen.findByText('Big List');
    await userEvent.click(summary);

    expect(await screen.findByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('search box in a long option list filters chips', async () => {
    const { apiCall } = await import('../lib/api.js');
    const manyOptions = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      label: i === 0 ? 'Alpha Item' : `Beta ${i}`,
    }));
    const bigTaxonomy = [
      {
        filterId: 999,
        label: 'Big List',
        kind: 'options',
        features: [{ featureId: 50, label: 'Big Feature', options: manyOptions }],
      },
    ];
    (apiCall as any).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/filter/taxonomy') return bigTaxonomy;
      if (endpoint === '/filter')
        return { ...FILTER_RESPONSE, generic: { category: 'house', filters: [] } };
      return [];
    });

    renderFilter();

    const summary = await screen.findByText('Big List');
    await userEvent.click(summary);

    const searchBox = await screen.findByPlaceholderText(/search/i);
    await userEvent.type(searchBox, 'Alpha');

    expect(screen.getByRole('button', { name: 'Alpha Item' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Beta 1' })).not.toBeInTheDocument();
  });
});

describe('FilterSelection schema', () => {
  it('options schema accepts valid options selection', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [776],
    });
    expect(result.success).toBe(true);
  });

  it('options schema rejects empty optionIds', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'options',
      filterId: 16,
      featureId: 1,
      optionIds: [],
    });
    expect(result.success).toBe(false);
  });

  it('range schema accepts min-only range', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1073,
      featureId: 244,
      min: '50',
    });
    expect(result.success).toBe(true);
  });

  it('range schema accepts max-only range', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1073,
      featureId: 244,
      max: '200',
    });
    expect(result.success).toBe(true);
  });

  it('range schema rejects when min > max', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'range',
      filterId: 1073,
      featureId: 244,
      min: '300',
      max: '200',
    });
    expect(result.success).toBe(false);
  });

  it('boolean schema accepts bare boolean selection', async () => {
    const { filterSelectionSchema } = await import('../lib/filterSchema.js');
    const result = filterSelectionSchema.safeParse({
      kind: 'boolean',
      filterId: 4132,
      featureId: 100,
    });
    expect(result.success).toBe(true);
  });

  it('genericFilterSchema accepts valid GenericFilter', async () => {
    const { genericFilterSchema } = await import('../lib/filterSchema.js');
    const result = genericFilterSchema.safeParse({
      category: 'house',
      filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }],
    });
    expect(result.success).toBe(true);
  });

  it('genericFilterSchema rejects unknown category', async () => {
    const { genericFilterSchema } = await import('../lib/filterSchema.js');
    const result = genericFilterSchema.safeParse({
      category: 'villa',
      filters: [],
    });
    expect(result.success).toBe(false);
  });
});

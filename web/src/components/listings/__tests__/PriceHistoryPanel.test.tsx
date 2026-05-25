import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { PriceHistoryPanel } from '../PriceHistoryPanel.js';
import { queryClient } from '../../../lib/query.js';

vi.mock('../../../lib/api.js', () => ({
  apiCall: vi.fn(),
}));

function renderPanel(listingId: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <PriceHistoryPanel listingId={listingId} />
    </QueryClientProvider>,
  );
}

describe('PriceHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.clear();
  });

  it('renders each price-distinct point with its delta', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({
      points: [
        {
          priceEur: 50_000,
          capturedAt: '2026-05-10T10:00:00Z',
          deltaPct: null,
          direction: 'baseline',
        },
        { priceEur: 51_000, capturedAt: '2026-05-15T10:00:00Z', deltaPct: 2.0, direction: 'up' },
        { priceEur: 48_960, capturedAt: '2026-05-20T10:00:00Z', deltaPct: -4.0, direction: 'down' },
      ],
    });

    renderPanel('h-1');

    // Newest first: the -4.0% change is shown before the baseline.
    expect(await screen.findByText('€48,960')).toBeInTheDocument();
    expect(screen.getByText('€51,000')).toBeInTheDocument();
    expect(screen.getByText('€50,000')).toBeInTheDocument();
    expect(screen.getByText(/-4\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\+2\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/first seen/i)).toBeInTheDocument();
    expect((apiCall as any).mock.calls[0][0]).toBe('/listings/h-1/price-history');
  });

  it('shows a "no changes" message for a single-point history', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({
      points: [
        {
          priceEur: 50_000,
          capturedAt: '2026-05-10T10:00:00Z',
          deltaPct: null,
          direction: 'baseline',
        },
      ],
    });

    renderPanel('h-2');

    expect(await screen.findByText(/no price changes recorded yet/i)).toBeInTheDocument();
  });

  it('shows a "no changes" message for an empty history', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    (apiCall as any).mockResolvedValue({ points: [] });

    renderPanel('h-3');

    expect(await screen.findByText(/no price changes recorded yet/i)).toBeInTheDocument();
  });

  it('shows an error message when the request fails', async () => {
    const { apiCall } = await import('../../../lib/api.js');
    queryClient.setDefaultOptions({ queries: { retry: false } });
    (apiCall as any).mockRejectedValue(new Error('boom'));

    renderPanel('h-err');

    expect(await screen.findByText(/failed to load price history/i)).toBeInTheDocument();
  });
});

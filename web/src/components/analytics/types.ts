export interface OverviewResponse {
  kpis: {
    medianEurPerSqm: number;
    activeInventory: number;
    medianDomDays: number;
    bestDealsCount: number;
    recentDropsCount: number;
  };
  trendByDistrict: Record<string, number[]>;
  months: string[];
  heatmap: Record<string, Record<string, number>>;
  domBuckets: { label: string; count: number; hot?: boolean; stale?: boolean }[];
  inventory12w: number[];
  newPerWeek: number[];
  gonePerWeek: number[];
  scatter: { id: string; areaSqm: number; priceK: number; district: string }[];
}

export interface BestBuyRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceEur: number;
  areaSqm: number;
  yearBuilt: number;
  daysOnMkt: number;
  eurPerSqm: number;
  medianEurPerSqm: number;
  discount: number;
  z: number;
  score: number;
  priceDrop: boolean;
  dropPct: number;
  rooms?: number;
}

export interface PriceDropRow {
  id: string;
  title: string;
  district: string;
  type: string;
  priceWas: number;
  priceEur: number;
  dropPct: number;
  dropEur: number;
  when: string;
}

// Color map keyed by district name. New districts that appear in observed
// data fall back to the teal accent at consumer sites — keeping this static
// is intentional (fully data-driven theming is a separate concern).
export const DIST_COLORS: Record<string, string> = {
  Buiucani: '#0f766e',
  Botanica: '#6366f1',
  Centru: '#dc2626',
  Ciocana: '#d97706',
  Durlești: '#059669',
  Râșcani: '#7c3aed',
};

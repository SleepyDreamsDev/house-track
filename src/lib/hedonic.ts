// Hedonic price model (P4 — AVM foundation). Pure functions, no I/O.
//
// Fits a ridge-regularized OLS regression of log(price) on listing attributes
// (area, rooms, year + one-hot sector / heating / type). The fitted model
// predicts an "expected" price for any listing; the residual — actual vs
// predicted, in percent — is the mispricing signal: strongly negative = a deal
// (priced below what its attributes warrant), strongly positive = aspirational.
//
// log-space target keeps the model multiplicative (a +€10k effect scales with
// the property) and makes residuals naturally percentage-like.
//
// Ridge (λ>0) keeps (XᵀX) invertible when one-hot dummies are collinear with
// the intercept or each other — unavoidable with sparse categorical data.
// Pass λ=0 for plain OLS on well-conditioned inputs.

// ── small dense linear algebra (row-major) ──

export function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: cols }, () => new Array<number>(rows).fill(0));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) out[j]![i] = m[i]![j]!;
  }
  return out;
}

export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const k = b.length;
  const p = b[0]?.length ?? 0;
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i++) {
    for (let x = 0; x < k; x++) {
      const aix = a[i]![x]!;
      if (aix === 0) continue;
      for (let j = 0; j < p; j++) out[i]![j]! += aix * b[x]![j]!;
    }
  }
  return out;
}

export function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, x, j) => s + x * (v[j] ?? 0), 0));
}

/** Invert a square matrix via Gauss-Jordan with partial pivoting. Throws if singular. */
export function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  const a = matrix.map((row, i) => [...row, ...identityRow(n, i)]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) throw new Error('matrix is singular');
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const pivVal = a[col]![col]!;
    for (let j = 0; j < 2 * n; j++) a[col]![j]! /= pivVal;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r]![j]! -= factor * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}

function identityRow(n: number, i: number): number[] {
  const row = new Array<number>(n).fill(0);
  row[i] = 1;
  return row;
}

/** Try ridgeFit, escalating λ on a singular matrix. Returns null if it never conditions. */
function fitWithEscalatingRidge(X: number[][], y: number[], lambda: number): number[] | null {
  for (const lam of [lambda, 1e-4, 1e-2, 1]) {
    try {
      return ridgeFit(X, y, lam);
    } catch {
      // singular at this λ — try a larger one
    }
  }
  return null;
}

/** Ridge OLS: β = (XᵀX + λI)⁻¹ Xᵀy. λ=0 → ordinary least squares. */
export function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  for (let i = 0; i < XtX.length; i++) XtX[i]![i]! += lambda;
  const XtY = matVec(Xt, y);
  return matVec(invert(XtX), XtY);
}

// ── hedonic model ──

export interface HedonicSample {
  priceEur: number | null;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt: number | null;
  sector: string | null;
  heatingType: string | null;
  type: string | null;
}

export interface HedonicModel {
  featureNames: string[];
  coefficients: number[];
  sectors: string[];
  heatingTypes: string[];
  types: string[];
  means: { rooms: number; yearBuilt: number };
  n: number;
  rSquared: number;
  /** Predict price (EUR) for a sample, or null if area/required inputs are missing. */
  predict(sample: HedonicSample): number | null;
}

const MISSING = '∅';

function cat(value: string | null): string {
  return value && value.trim().length > 0 ? value : MISSING;
}

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
}

/**
 * Fit log(price) ~ area + rooms + yearBuilt + one-hot(sector, heating, type).
 * Only rows with a positive price and area train the model; missing rooms/year
 * are mean-imputed, missing categoricals get a "∅" level. Reference levels are
 * dropped (first sorted value per categorical) so the intercept is identified.
 */
export function fitHedonic(samples: HedonicSample[], lambda = 1e-6): HedonicModel | null {
  const usable = samples.filter(
    (s): s is HedonicSample & { priceEur: number; areaSqm: number } =>
      s.priceEur != null && s.priceEur > 0 && s.areaSqm != null && s.areaSqm > 0,
  );
  if (usable.length < 2) return null;

  const sectors = uniqueLevels(usable.map((s) => cat(s.sector)));
  const heatingTypes = uniqueLevels(usable.map((s) => cat(s.heatingType)));
  const types = uniqueLevels(usable.map((s) => cat(s.type)));
  const means = {
    rooms: mean(usable.filter((s) => s.rooms != null).map((s) => s.rooms as number)),
    yearBuilt: mean(usable.filter((s) => s.yearBuilt != null).map((s) => s.yearBuilt as number)),
  };

  const featureNames = [
    'intercept',
    'areaSqm',
    'rooms',
    'yearBuilt',
    ...sectors.slice(1).map((s) => `sector=${s}`),
    ...heatingTypes.slice(1).map((h) => `heating=${h}`),
    ...types.slice(1).map((t) => `type=${t}`),
  ];

  const X = usable.map((s) => rowVector(s, sectors, heatingTypes, types, means));
  const y = usable.map((s) => Math.log(s.priceEur));
  // Real categorical data is often collinear (sparse dummies), which can make
  // (XᵀX + λI) singular at a tiny λ. Escalate λ rather than 500 the caller.
  const coefficients = fitWithEscalatingRidge(X, y, lambda);
  if (coefficients == null) return null;

  // R² on the log target.
  const yMean = mean(y);
  const preds = X.map((row) => row.reduce((acc, v, j) => acc + v * (coefficients[j] ?? 0), 0));
  const ssRes = y.reduce((acc, yi, i) => acc + (yi - (preds[i] ?? 0)) ** 2, 0);
  const ssTot = y.reduce((acc, yi) => acc + (yi - yMean) ** 2, 0);
  const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const model: HedonicModel = {
    featureNames,
    coefficients,
    sectors,
    heatingTypes,
    types,
    means,
    n: usable.length,
    rSquared,
    predict(sample: HedonicSample): number | null {
      if (sample.areaSqm == null || sample.areaSqm <= 0) return null;
      const row = rowVector(
        { ...sample, priceEur: sample.priceEur ?? 1, areaSqm: sample.areaSqm },
        sectors,
        heatingTypes,
        types,
        means,
      );
      const logPrice = row.reduce((acc, v, j) => acc + v * (coefficients[j] ?? 0), 0);
      return Math.exp(logPrice);
    },
  };
  return model;
}

/** Signed mispricing: (actual − predicted) / predicted. Negative = underpriced. */
export function residualPct(actual: number, predicted: number): number {
  if (predicted <= 0) return 0;
  return (actual - predicted) / predicted;
}

function uniqueLevels(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function oneHotTail(value: string, levels: string[]): number[] {
  // Drop the first (reference) level; emit indicators for the rest.
  return levels.slice(1).map((lvl) => (value === lvl ? 1 : 0));
}

function rowVector(
  s: HedonicSample & { areaSqm: number },
  sectors: string[],
  heatingTypes: string[],
  types: string[],
  means: { rooms: number; yearBuilt: number },
): number[] {
  return [
    1, // intercept
    s.areaSqm,
    s.rooms ?? means.rooms,
    s.yearBuilt ?? means.yearBuilt,
    ...oneHotTail(cat(s.sector), sectors),
    ...oneHotTail(cat(s.heatingType), heatingTypes),
    ...oneHotTail(cat(s.type), types),
  ];
}

import { describe, expect, it } from 'vitest';

import {
  fitHedonic,
  invert,
  matMul,
  matVec,
  residualPct,
  ridgeFit,
  transpose,
  type HedonicSample,
} from '../hedonic.js';

describe('linear algebra', () => {
  it('transpose flips rows and columns', () => {
    expect(
      transpose([
        [1, 2, 3],
        [4, 5, 6],
      ]),
    ).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  it('matMul multiplies conformable matrices', () => {
    expect(
      matMul(
        [
          [1, 2],
          [3, 4],
        ],
        [
          [5, 6],
          [7, 8],
        ],
      ),
    ).toEqual([
      [19, 22],
      [43, 50],
    ]);
  });

  it('matVec applies a matrix to a vector', () => {
    expect(
      matVec(
        [
          [1, 2],
          [3, 4],
        ],
        [1, 1],
      ),
    ).toEqual([3, 7]);
  });

  it('invert produces a true inverse (A·A⁻¹ = I)', () => {
    const inv = invert([
      [4, 7],
      [2, 6],
    ]);
    expect(inv[0]![0]).toBeCloseTo(0.6, 6);
    expect(inv[0]![1]).toBeCloseTo(-0.7, 6);
    expect(inv[1]![0]).toBeCloseTo(-0.2, 6);
    expect(inv[1]![1]).toBeCloseTo(0.4, 6);
  });

  it('invert throws on a singular matrix', () => {
    expect(() =>
      invert([
        [1, 2],
        [2, 4],
      ]),
    ).toThrow(/singular/);
  });
});

describe('ridgeFit', () => {
  it('recovers exact OLS coefficients on linear data (λ=0)', () => {
    // y = 2 + 3x
    const X = [
      [1, 0],
      [1, 1],
      [1, 2],
      [1, 3],
    ];
    const y = [2, 5, 8, 11];
    const beta = ridgeFit(X, y, 0);
    expect(beta[0]).toBeCloseTo(2, 6);
    expect(beta[1]).toBeCloseTo(3, 6);
  });
});

describe('residualPct', () => {
  it('is negative for underpriced and positive for overpriced', () => {
    expect(residualPct(80, 100)).toBeCloseTo(-0.2, 6);
    expect(residualPct(120, 100)).toBeCloseTo(0.2, 6);
  });
});

describe('fitHedonic', () => {
  // price = exp(11 + 0.002 * area); area varies, everything else constant.
  const base: Omit<HedonicSample, 'priceEur' | 'areaSqm'> = {
    rooms: 3,
    yearBuilt: 2010,
    sector: 'Centru',
    heatingType: 'autonoma',
    type: 'house',
  };
  const fair = (area: number): HedonicSample => ({
    ...base,
    areaSqm: area,
    priceEur: Math.exp(11 + 0.002 * area),
  });
  const samples = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 200].map(fair);

  it('fits a log-linear relationship with high R² and accurate prediction', () => {
    const model = fitHedonic(samples);
    expect(model).not.toBeNull();
    expect(model!.n).toBe(samples.length);
    expect(model!.rSquared).toBeGreaterThan(0.99);
    const predicted = model!.predict({ ...base, areaSqm: 100, priceEur: null });
    expect(predicted).not.toBeNull();
    expect(predicted!).toBeCloseTo(Math.exp(11 + 0.002 * 100), -1); // within ~order of €
  });

  it('flags a planted underpriced listing with a strongly negative residual', () => {
    const model = fitHedonic(samples)!;
    const dealArea = 120;
    const predicted = model.predict({ ...base, areaSqm: dealArea, priceEur: null })!;
    const dealPrice = predicted * 0.6; // 40% under model
    expect(residualPct(dealPrice, predicted)).toBeLessThan(-0.3);
  });

  it('returns null with fewer than two usable rows', () => {
    expect(fitHedonic([{ ...base, areaSqm: 100, priceEur: null }])).toBeNull();
  });
});

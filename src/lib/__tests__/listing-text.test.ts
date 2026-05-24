import { describe, expect, it } from 'vitest';

import {
  bumpRegularity,
  isWeekend,
  normalizeText,
  photoQuality,
  postingHourHistogram,
  scanDistress,
} from '../listing-text.js';

const DAY = 24 * 60 * 60 * 1000;

describe('normalizeText', () => {
  it('lowercases and strips Romanian diacritics, keeps Cyrillic', () => {
    expect(normalizeText('Preț REDUS')).toBe('pret redus');
    expect(normalizeText('СРОЧНО')).toBe('срочно');
  });
});

describe('scanDistress', () => {
  it('detects urgency, reduced and exchange across diacritics/case', () => {
    const r = scanDistress('Se vinde URGENT, preț redus, accept schimb auto');
    expect(r.signals).toContain('urgency');
    expect(r.signals).toContain('reduced');
    expect(r.signals).toContain('exchange');
    expect(r.distressed).toBe(true);
    expect(r.score).toBe(r.signals.length);
  });

  it('detects Russian terms', () => {
    const r = scanDistress('Срочно продаю, возможна рассрочка, торг');
    expect(r.signals).toEqual(expect.arrayContaining(['urgency', 'installments', 'negotiable']));
  });

  it('returns empty for neutral or null descriptions', () => {
    expect(scanDistress('Apartament spațios cu vedere frumoasă')).toEqual({
      signals: [],
      score: 0,
      distressed: false,
    });
    expect(scanDistress(null).distressed).toBe(false);
  });

  it('counts each category once even with multiple matching terms', () => {
    const r = scanDistress('urgent urgent urgenta'); // all "urgency"
    expect(r.signals).toEqual(['urgency']);
    expect(r.score).toBe(1);
  });
});

describe('photoQuality', () => {
  it('buckets by image count', () => {
    expect(photoQuality(0)).toBe('none');
    expect(photoQuality(2)).toBe('sparse');
    expect(photoQuality(5)).toBe('ok');
    expect(photoQuality(12)).toBe('rich');
  });
});

describe('isWeekend', () => {
  it('flags Saturday and Sunday (UTC)', () => {
    expect(isWeekend(new Date('2026-05-23T12:00:00Z'))).toBe(true); // Sat
    expect(isWeekend(new Date('2026-05-24T12:00:00Z'))).toBe(true); // Sun
    expect(isWeekend(new Date('2026-05-25T12:00:00Z'))).toBe(false); // Mon
  });
});

describe('postingHourHistogram', () => {
  it('counts UTC hours into 24 slots', () => {
    const hist = postingHourHistogram([
      new Date('2026-05-01T09:00:00Z'),
      new Date('2026-05-02T09:30:00Z'),
      new Date('2026-05-03T22:00:00Z'),
    ]);
    expect(hist).toHaveLength(24);
    expect(hist[9]).toBe(2);
    expect(hist[22]).toBe(1);
    expect(hist[0]).toBe(0);
  });
});

describe('bumpRegularity', () => {
  it('returns ~1 for perfectly regular bumps', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const regular = [0, 7, 14, 21].map((d) => new Date(t0 + d * DAY));
    expect(bumpRegularity(regular)).toBeCloseTo(1, 5);
  });

  it('returns lower for irregular bumps', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const irregular = [0, 1, 14, 15].map((d) => new Date(t0 + d * DAY));
    const reg = bumpRegularity(irregular);
    expect(reg).not.toBeNull();
    expect(reg!).toBeLessThan(0.6);
  });

  it('returns null with fewer than 3 timestamps', () => {
    expect(bumpRegularity([new Date(), new Date()])).toBeNull();
  });
});

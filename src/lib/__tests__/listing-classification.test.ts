import { describe, it, expect } from 'vitest';
import { detectType, isRegionMismatch, classifyListing, fold } from '../listing-classification.js';

describe('detectType', () => {
  it('plain house title stays House', () => {
    expect(detectType('Casă, 140 m², Colonița')).toBe('House');
  });

  it('duplex anywhere in the text wins', () => {
    expect(detectType('Casă, 200 m². Vând duplex nou.')).toBe('Duplex');
  });

  it('"Town House" with a space is a Townhouse', () => {
    expect(detectType('Casa de tip Town House')).toBe('Townhouse');
  });

  it('Cyrillic таунхаус is a Townhouse', () => {
    expect(detectType('Продается таунхаус')).toBe('Townhouse');
  });

  it('vilă is a Villa', () => {
    expect(detectType('Vilă de lux, 300 m²')).toBe('Villa');
  });

  it('Duplex outranks townhouse when both appear', () => {
    expect(detectType('duplex în ansamblu de townhouse')).toBe('Duplex');
  });

  it('negation "nu este duplex" is not a duplex', () => {
    expect(detectType('Casă individuală, nu este duplex')).toBe('House');
  });

  it('proximity "lângă un townhouse" is not a townhouse', () => {
    expect(detectType('Casă amplasată lângă un townhouse')).toBe('House');
  });

  it('does not match duplex inside a larger word', () => {
    expect(detectType('Casă cu acoperiș duplexat oarecare')).toBe('House');
  });

  it('does not match "downtown house" as a townhouse', () => {
    expect(detectType('Casă în zona downtown house deschisă')).toBe('House');
  });

  it('negation survives a longer Romanian phrase', () => {
    expect(detectType('Casă lângă magazinul mare ce are un townhouse')).toBe('House');
  });
});

describe('fold', () => {
  it('collapses the î/â spelling of Sîngera/Sângera', () => {
    expect(fold('Sîngera')).toBe(fold('Sângera'));
  });
  it('folds ă/ș/ț and case for Băcioi/Bacioi', () => {
    expect(fold('Băcioi')).toBe(fold('Bacioi'));
  });
});

describe('isRegionMismatch', () => {
  it.each(['Drochia', 'Fălești', 'Ialoveni', 'Răzeni', 'Cojușna', 'Ratuș'])(
    'flags outsider %s',
    (d) => {
      expect(isRegionMismatch(d)).toBe(true);
    },
  );

  it.each(['Chișinău', 'Durlești', 'Bîc', 'Dumbrava', 'Cheltuitori', 'Brăila', 'Sângera'])(
    'does not flag municipality locality %s',
    (d) => {
      expect(isRegionMismatch(d)).toBe(false);
    },
  );

  it('null district is not flagged', () => {
    expect(isRegionMismatch(null)).toBe(false);
  });

  it('whitespace-only district is not flagged', () => {
    expect(isRegionMismatch('   ')).toBe(false);
  });
});

describe('classifyListing', () => {
  it('description-only duplex on a House title flags typeMismatch', () => {
    const c = classifyListing({
      title: 'Casă, 200 m², Chișinău',
      description: 'Casă tip duplex, complet finisată',
      district: 'Chișinău',
    });
    expect(c.derivedType).toBe('Duplex');
    expect(c.typeMismatch).toBe(true);
    expect(c.regionMismatch).toBe(false);
    expect(c.reasons).toContain('type: duplex');
  });

  it('out-of-region plain house flags regionMismatch only', () => {
    const c = classifyListing({
      title: 'Casă, 120 m²',
      description: null,
      district: 'Ialoveni',
    });
    expect(c.typeMismatch).toBe(false);
    expect(c.regionMismatch).toBe(true);
    expect(c.reasons).toEqual(['region: Ialoveni']);
  });

  it('clean listing has no flags', () => {
    const c = classifyListing({
      title: 'Casă, 90 m², Durlești',
      description: 'Casă pe pământ',
      district: 'Durlești',
    });
    expect(c.typeMismatch).toBe(false);
    expect(c.regionMismatch).toBe(false);
    expect(c.reasons).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { deriveSector, CHISINAU_SECTORS } from '../chisinau-sector.js';

const base = { district: 'Chișinău', street: null, title: null, description: null };

describe('deriveSector', () => {
  it('Explicit sector mention classifies a Chișinău listing', () => {
    expect(deriveSector({ ...base, title: 'Casă cu 3 niveluri, sect. Centru' })).toBe('Centru');
  });

  it('Bare keyword in the street classifies a Chișinău listing', () => {
    expect(deriveSector({ ...base, street: 'str. Buiucani' })).toBe('Buiucani');
  });

  it('Diacritic-insensitive keyword matches Râșcani', () => {
    expect(deriveSector({ ...base, description: 'apartament in riscani' })).toBe('Râșcani');
  });

  // The four neighborhood zones 999 lists alongside the official sectors now
  // resolve to themselves instead of being collapsed into a sector.
  it('Sculeni is its own zone (not Buiucani)', () => {
    expect(deriveSector({ ...base, street: 'str. Sculeni' })).toBe('Sculeni');
  });

  it('Telecentru is its own zone (not Centru)', () => {
    expect(deriveSector({ ...base, title: 'Casă, Telecentru' })).toBe('Telecentru');
  });

  it('Poșta Veche is its own zone', () => {
    expect(deriveSector({ ...base, description: 'casă în Poșta Veche' })).toBe('Poșta Veche');
  });

  it('Aeroport is recognized as a zone', () => {
    expect(deriveSector({ ...base, street: 'zona Aeroport' })).toBe('Aeroport');
  });

  it('Telecentru wins over the bare Centru keyword', () => {
    expect(deriveSector({ ...base, description: 'în telecentru, aproape de centru' })).toBe(
      'Telecentru',
    );
  });

  it('A Chișinău listing with no signal is left unclassified', () => {
    expect(deriveSector({ ...base, street: 'str. Nuferilor', title: 'Casă, 49 m²' })).toBeNull();
  });

  it('does not match centru inside a larger word', () => {
    expect(deriveSector({ ...base, description: 'aproape de centrul vechi' })).toBeNull();
  });

  it('A commune listing is never assigned a sector', () => {
    expect(
      deriveSector({ district: 'Durlești', street: 'str. Centru', title: null, description: null }),
    ).toBeNull();
  });

  it('Null district is never assigned a sector', () => {
    expect(deriveSector({ ...base, district: null, street: 'str. Botanica' })).toBeNull();
  });

  it('exposes all nine Chișinău zones', () => {
    expect([...CHISINAU_SECTORS]).toEqual([
      'Centru',
      'Botanica',
      'Râșcani',
      'Ciocana',
      'Buiucani',
      'Telecentru',
      'Sculeni',
      'Poșta Veche',
      'Aeroport',
    ]);
  });
});

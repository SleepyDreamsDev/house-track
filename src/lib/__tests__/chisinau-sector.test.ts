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

  it('Gazetteer neighborhood classifies when no sector keyword is present', () => {
    expect(deriveSector({ ...base, street: 'str. Sculeni' })).toBe('Buiucani');
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

  it('exposes the five official sectors', () => {
    expect([...CHISINAU_SECTORS]).toEqual(['Centru', 'Botanica', 'Râșcani', 'Ciocana', 'Buiucani']);
  });
});

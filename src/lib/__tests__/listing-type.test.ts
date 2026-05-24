import { describe, it, expect } from 'vitest';
import { deriveType } from '../listing-type.js';

describe('deriveType', () => {
  it('detects Duplex from the title', () => {
    expect(deriveType('Casă duplex, 180 m²')).toBe('Duplex');
  });
  it('detects Townhouse with a space', () => {
    expect(deriveType('Casa de tip Town House')).toBe('Townhouse');
  });
  it('detects Villa', () => {
    expect(deriveType('Vilă, 250 m²')).toBe('Villa');
  });
  it('defaults to House', () => {
    expect(deriveType('Casă, 100 m², Durlești')).toBe('House');
  });
});

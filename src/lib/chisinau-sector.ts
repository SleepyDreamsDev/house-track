// src/lib/chisinau-sector.ts
//
// Best-effort derivation of Chișinău city sectors from listing free text.
// The 999.md source does NOT subdivide Chișinău (it is one flat locality),
// so sectors are inferred from street/title/description and are expected to
// miss — unclassifiable city listings return null ("Unknown"). Communes and
// non-Chișinău districts always return null.

export const CHISINAU_SECTORS = ['Centru', 'Botanica', 'Râșcani', 'Ciocana', 'Buiucani'] as const;
export type ChisinauSector = (typeof CHISINAU_SECTORS)[number];

// Generic sector keywords, diacritic- and ASCII-tolerant. Centru is last so a
// neighborhood like "Telecentru" still resolves to Centru while more specific
// words win first.
const KEYWORDS: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
  [/botanica/i, 'Botanica'],
  [/r[âîi]șcani|riscani|rascani/i, 'Râșcani'],
  [/ciocana/i, 'Ciocana'],
  [/buiucani/i, 'Buiucani'],
  [/telecentru|centru/i, 'Centru'],
];

// Well-known neighborhoods/streets with no sector word in them. Best-effort,
// expected to be incomplete.
const GAZETTEER: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
  [/sculeni/i, 'Buiucani'],
  [/po[șs]ta\s+veche/i, 'Râșcani'],
  [/schinoasa/i, 'Centru'],
  [/valea\s+morilor/i, 'Centru'],
];

export function deriveSector(input: {
  district: string | null;
  street: string | null;
  title: string | null;
  description: string | null;
}): ChisinauSector | null {
  if (input.district !== 'Chișinău') return null;
  const hay = [input.street, input.title, input.description].filter(Boolean).join(' ');
  if (!hay) return null;

  // 1. Explicit "sect. X" / "sectorul X" — strongest signal.
  const explicit = hay.match(
    /sect(?:or(?:ul)?)?\.?\s*(botanica|r[âîi]șcani|riscani|rascani|ciocana|buiucani|centru)/i,
  );
  if (explicit) {
    for (const [re, sector] of KEYWORDS) if (re.test(explicit[0])) return sector;
  }

  // 2. Bare keyword anywhere.
  for (const [re, sector] of KEYWORDS) if (re.test(hay)) return sector;

  // 3. Gazetteer neighborhoods.
  for (const [re, sector] of GAZETTEER) if (re.test(hay)) return sector;

  return null;
}

// 999.md lists Chișinău city's sub-areas as one flat zone list (5 official
// sectors + 4 neighborhoods). Sellers rarely tag the structured zone option —
// it's verified to live in the free text — so zones are inferred from
// street/title/description and are expected to miss (unclassifiable → null).

export const CHISINAU_SECTORS = [
  'Centru',
  'Botanica',
  'Râșcani',
  'Ciocana',
  'Buiucani',
  'Telecentru',
  'Sculeni',
  'Poșta Veche',
  'Aeroport',
] as const;
export type ChisinauSector = (typeof CHISINAU_SECTORS)[number];

// Diacritic- and ASCII-tolerant, with Russian aliases (999 has RU listings).
// Ordering matters: the more specific "Telecentru" must be tried before the
// bare "Centru" so it isn't shadowed.
const KEYWORDS: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
  [/aeroport|аэропорт/i, 'Aeroport'],
  [/botanica|ботаника/i, 'Botanica'],
  [/r[âîi]șcani|riscani|rascani|рышкан/i, 'Râșcani'],
  [/ciocana|чокан/i, 'Ciocana'],
  [/buiucani|буюкан/i, 'Buiucani'],
  [/sculeni|скулян/i, 'Sculeni'],
  [/po[șs]ta\s+veche|старая\s+почта/i, 'Poșta Veche'],
  [/telecentru|телецентр/i, 'Telecentru'],
  [/\bcentru\b|\bцентр\b/i, 'Centru'],
];

// Well-known neighborhoods/streets with no zone word in them. Best-effort,
// expected to be incomplete.
const GAZETTEER: ReadonlyArray<readonly [RegExp, ChisinauSector]> = [
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
    /sect(?:or(?:ul)?)?\.?\s*(aeroport|botanica|r[âîi]șcani|riscani|rascani|ciocana|buiucani|sculeni|po[șs]ta\s+veche|telecentru|centru)/i,
  );
  if (explicit) {
    for (const [re, sector] of KEYWORDS) if (re.test(explicit[0])) return sector;
  }

  // 2. Bare keyword anywhere (Telecentru before Centru — see KEYWORDS order).
  for (const [re, sector] of KEYWORDS) if (re.test(hay)) return sector;

  // 3. Gazetteer neighborhoods.
  for (const [re, sector] of GAZETTEER) if (re.test(hay)) return sector;

  return null;
}

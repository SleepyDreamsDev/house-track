// Read-time detection of mislabeled listings (Phase 1 — no DB columns).
// Spec: docs/superpowers/specs/2026-05-24-mislabel-detection-design.md

export type DerivedType = 'House' | 'Villa' | 'Townhouse' | 'Duplex';

// Higher-priority types first: a listing that says both "duplex" and
// "townhouse" is reported as the more specific Duplex.
const TYPE_RULES: ReadonlyArray<readonly [DerivedType, RegExp]> = [
  ['Duplex', /\bduplex\b/i],
  // \b on "town" stops "downtown house" from matching.
  ['Townhouse', /\btown\s?house\b|таунхаус/i],
  // Trailing lookahead instead of \b: ASCII \b does not fire after "ă".
  ['Villa', /\bvil[aă](?![a-zăâîșț])/i],
];

// Negation / proximity cues that, when they appear just before a match,
// mean the listing is NOT that type ("nu este duplex", "lângă un townhouse").
// Trailing lookahead instead of \b for the same diacritic reason as above.
const NEG_CUE =
  /(nu\s+e(?:ste)?|f[ăa]r[ăa]|l[âaî]ng[ăa]|vecin[ăa]tate|al[ăa]turi|aproape\s+de)(?![a-zăâîșț])/i;

function isNegated(textBeforeMatch: string): boolean {
  // Only the immediate run-up matters; a negation 200 chars earlier is noise.
  // 40 chars covers compound Romanian phrases ("lângă … ce are un …").
  return NEG_CUE.test(textBeforeMatch.slice(-40));
}

export function detectType(haystack: string): DerivedType {
  for (const [type, re] of TYPE_RULES) {
    const m = haystack.match(re);
    if (!m || m.index === undefined) continue;
    if (isNegated(haystack.slice(0, m.index))) continue;
    return type;
  }
  return 'House';
}

// Normalize a locality string for comparison: lowercase, collapse the
// Romanian î/â spelling pair to one letter, strip the remaining diacritics
// (ă→a, ș→s, ț→t), and reduce any non-alphanumeric run to a single space.
// So "Sîngera" === "Sângera" and "Băcioi" === "Bacioi".
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/[âî]/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Official Chișinău municipality: 5 sectors + 6 towns + 12 communes and their
// villages. Add a locality here if a false positive appears.
const MUNICIPALITY_LOCALITIES = [
  'Chișinău',
  'Codru',
  'Cricova',
  'Durlești',
  'Sîngera',
  'Vadul lui Vodă',
  'Vatra',
  'Băcioi',
  'Brăila',
  'Frumușica',
  'Străisteni',
  'Bubuieci',
  'Bîc',
  'Humulești',
  'Budești',
  'Văduleni',
  'Ciorescu',
  'Făurești',
  'Goian',
  'Colonița',
  'Cruzești',
  'Ceroborta',
  'Ghidighici',
  'Grătiești',
  'Hulboaca',
  'Stăuceni',
  'Goianul Nou',
  'Tohatin',
  'Buneți',
  'Cheltuitori',
  'Trușeni',
  'Dumbrava',
  'Revaca',
] as const;

export const MUNICIPALITY_ALLOWLIST: ReadonlySet<string> = new Set(
  MUNICIPALITY_LOCALITIES.map(fold),
);

export function isRegionMismatch(district: string | null): boolean {
  if (district == null) return false;
  const f = fold(district);
  if (!f) return false;
  return !MUNICIPALITY_ALLOWLIST.has(f);
}

// True when `district` is a locality of the Chișinău municipality (the city
// proper or one of its towns/communes). Drives the "Chișinău (municipality)"
// District filter group, which expands to every observed member locality.
export function isMunicipalityLocality(district: string | null): boolean {
  if (district == null) return false;
  const f = fold(district);
  return f !== '' && MUNICIPALITY_ALLOWLIST.has(f);
}

export interface Classification {
  derivedType: DerivedType;
  typeMismatch: boolean;
  regionMismatch: boolean;
  reasons: string[];
}

export function classifyListing(input: {
  title: string;
  description: string | null;
  district: string | null;
}): Classification {
  const haystack = `${input.title} \n ${input.description ?? ''}`;
  const derivedType = detectType(haystack);
  const typeMismatch = derivedType !== 'House';
  const regionMismatch = isRegionMismatch(input.district);

  const reasons: string[] = [];
  if (typeMismatch) reasons.push(`type: ${derivedType.toLowerCase()}`);
  if (regionMismatch) reasons.push(`region: ${input.district}`);

  return { derivedType, typeMismatch, regionMismatch, reasons };
}

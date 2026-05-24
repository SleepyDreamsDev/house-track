# Mislabel Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag listings sold as plain houses that are actually duplex/townhouse/villa, and listings advertised in Chișinău that are actually in another raion — surfaced as badges in the Listings UI with an opt-in "hide mislabeled" toggle.

**Architecture:** Phase 1 is **read-time** derivation (no schema change, per the design's hybrid decision). A new pure module `src/lib/listing-classification.ts` owns both detectors. `searchListings` (the listings query) maps each row through it and adds four fields to the API payload. The web Listings page renders badges from those fields and filters client-side when the toggle is on. Phase 2 (persisting the flags) is a separate later plan.

**Tech Stack:** Node 22 + TS strict (ESM, `.js` import extensions) · Prisma · Hono · Vitest · React 18 + Vite + Tailwind · React Testing Library.

**Spec:** `docs/superpowers/specs/2026-05-24-mislabel-detection-design.md`

---

## File Structure

| File | Responsibility | Action |
| --- | --- | --- |
| `src/lib/listing-classification.ts` | Pure detectors: `detectType`, `isRegionMismatch`, `classifyListing`, `fold`, `MUNICIPALITY_ALLOWLIST` | Create |
| `src/lib/__tests__/listing-classification.test.ts` | Unit tests for the detectors | Create |
| `src/lib/listing-type.ts` | Extend `ListingType` with `'Duplex'`; `deriveType` delegates to `detectType` | Modify |
| `src/mcp/queries.ts` | Add 4 fields to `SearchListingsRow` + populate in the `.map()` | Modify |
| `web/src/components/listings/ListingsTable.tsx` | Render mislabel badges in the table view | Modify |
| `web/src/pages/Listings.tsx` | `Listing` type fields, badges in card view, "Hide mislabeled" toggle + client-side filter | Modify |
| `web/src/__tests__/Listings.test.tsx` | Badge render + hide-toggle behavior | Modify |

Convention reminders: ESM relative imports MUST end in `.js`. No comments unless the WHY is non-obvious. `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` are on. Commit messages: Conventional Commits (scopes incl. `parse`, `web`).

---

## Task 1: Pure detection module

**Files:**
- Create: `src/lib/listing-classification.ts`
- Test: `src/lib/__tests__/listing-classification.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/listing-classification.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  detectType,
  isRegionMismatch,
  classifyListing,
  fold,
} from '../listing-classification.js';

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
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm test src/lib/__tests__/listing-classification.test.ts`
Expected: FAIL — `Cannot find module '../listing-classification.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/listing-classification.ts`:

```ts
// Read-time detection of mislabeled listings (Phase 1 — no DB columns).
// Spec: docs/superpowers/specs/2026-05-24-mislabel-detection-design.md

export type DerivedType = 'House' | 'Villa' | 'Townhouse' | 'Duplex';

// Higher-priority types first: a listing that says both "duplex" and
// "townhouse" is reported as the more specific Duplex.
const TYPE_RULES: ReadonlyArray<readonly [DerivedType, RegExp]> = [
  ['Duplex', /\bduplex\b/i],
  ['Townhouse', /town\s?house|таунхаус/i],
  ['Villa', /\bvil[ăa]\b/i],
];

// Negation / proximity cues that, when they appear just before a match,
// mean the listing is NOT that type ("nu este duplex", "lângă un townhouse").
const NEG_CUE = /(nu\s+e(?:ste)?|f[ăa]r[ăa]|l[âaî]ng[ăa]|vecin[ăa]tate|al[ăa]turi|aproape\s+de)\b/i;

function isNegated(textBeforeMatch: string): boolean {
  // Only the immediate run-up matters; a negation 200 chars earlier is noise.
  return NEG_CUE.test(textBeforeMatch.slice(-25));
}

export function detectType(haystack: string): DerivedType {
  for (const [type, re] of TYPE_RULES) {
    const m = re.exec(haystack);
    if (!m) continue;
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
  'Codru', 'Cricova', 'Durlești', 'Sîngera', 'Vadul lui Vodă', 'Vatra',
  'Băcioi', 'Brăila', 'Frumușica', 'Străisteni',
  'Bubuieci', 'Bîc', 'Humulești',
  'Budești', 'Văduleni',
  'Ciorescu', 'Făurești', 'Goian',
  'Colonița',
  'Cruzești', 'Ceroborta',
  'Ghidighici',
  'Grătiești', 'Hulboaca',
  'Stăuceni', 'Goianul Nou',
  'Tohatin', 'Buneți', 'Cheltuitori',
  'Trușeni', 'Dumbrava',
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
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm test src/lib/__tests__/listing-classification.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/listing-classification.ts src/lib/__tests__/listing-classification.test.ts
git commit -m "feat(parse): add read-time mislabel detection (type + region)"
```

---

## Task 2: Fold Duplex into the existing `deriveType`

Keeps a single source of truth for type detection. `deriveType(title)` is used by the
facets endpoint and analytics; after this change it can also return `'Duplex'`.

**Files:**
- Modify: `src/lib/listing-type.ts`
- Test: `src/lib/__tests__/listing-type.test.ts`

- [ ] **Step 1: Write the failing test**

There is currently no dedicated test for `deriveType`. Create
`src/lib/__tests__/listing-type.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it, verify the Duplex case fails**

Run: `pnpm test src/lib/__tests__/listing-type.test.ts`
Expected: FAIL — `deriveType('Casă duplex…')` currently returns `'House'`.

- [ ] **Step 3: Make `deriveType` delegate to `detectType`**

Edit `src/lib/listing-type.ts`. Replace the `ListingType` type and `deriveType` function
(keep `roomsBucket` and `RoomsBucket` exactly as-is below):

```ts
import { detectType, type DerivedType } from './listing-classification.js';

export type ListingType = DerivedType;
export type RoomsBucket = '1–2' | '3' | '4' | '5+';

export function deriveType(title: string): ListingType {
  return detectType(title);
}
```

- [ ] **Step 4: Run tests, verify pass + no regressions**

Run: `pnpm test src/lib/__tests__/listing-type.test.ts && pnpm test src/web/routes/__tests__`
Expected: PASS. The analytics/facets tests that call `deriveType` still pass (House/Villa/Townhouse outputs are unchanged; Duplex is purely additive).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (`analytics.ts` imports `deriveType`/`roomsBucket` from this file; the wider `ListingType` union is assignment-compatible.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/listing-type.ts src/lib/__tests__/listing-type.test.ts
git commit -m "feat(parse): deriveType recognizes Duplex via shared detector"
```

---

## Task 3: Expose flags from the listings query

**Files:**
- Modify: `src/mcp/queries.ts` (interface `SearchListingsRow` ~line 63; the `.map()` ~line 275)

- [ ] **Step 1: Add the fields to `SearchListingsRow`**

Edit `src/mcp/queries.ts`. Add an import near the top (after the existing imports):

```ts
import { classifyListing, type DerivedType } from '../lib/listing-classification.js';
```

Extend the `SearchListingsRow` interface (it currently ends at `lastSeenAt`):

```ts
export interface SearchListingsRow {
  id: string;
  url: string;
  title: string;
  priceEur: number | null;
  priceRaw: string | null;
  areaSqm: number | null;
  rooms: number | null;
  district: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  derivedType: DerivedType;
  typeMismatch: boolean;
  regionMismatch: boolean;
  mismatchReasons: string[];
}
```

- [ ] **Step 2: Populate the fields in the `.map()`**

In `searchListings`, the return maps `rows` to row objects (currently ending with
`watchlist: r.watchlist`). Replace that `.map(...)` callback so it classifies each row:

```ts
    listings: rows.map((r) => {
      const cls = classifyListing({
        title: r.title,
        description: r.description,
        district: r.district,
      });
      return {
        id: r.id,
        url: r.url,
        title: r.title,
        priceEur: r.priceEur,
        priceRaw: r.priceRaw,
        areaSqm: r.areaSqm,
        rooms: r.rooms,
        district: r.district,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        lastFetchedAt: r.lastFetchedAt.toISOString(),
        watchlist: r.watchlist,
        derivedType: cls.derivedType,
        typeMismatch: cls.typeMismatch,
        regionMismatch: cls.regionMismatch,
        mismatchReasons: cls.reasons,
      };
    }),
```

`r.description` is available because both query paths (`allRows` and the priceDrop
`include: { snapshots: true }` path) select the full `Listing` row with no `select` clause.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (`lastFetchedAt`/`watchlist` were already returned by the map even
though absent from the interface; leaving them is fine. If the typecheck objects that the
mapped object is not assignable to `SearchListingsRow`, that is pre-existing and unrelated —
do not widen scope; report it.)

- [ ] **Step 4: Behavioral sanity check against the live DB**

The crawler Postgres is running (`docker ps` → `house-track-postgres`). Start the API and
confirm the new fields appear. In one terminal start the dev server (`pnpm dev`; note the
port from its startup log — default 3000). In another, filter the response with `jq`:

```bash
curl -s 'http://localhost:3000/api/listings?limit=200' \
  | jq '[.listings[] | select(.typeMismatch or .regionMismatch)
         | {title, derivedType, typeMismatch, regionMismatch, mismatchReasons}][:10]'
```

Expected: at least several rows with `typeMismatch: true` (derivedType Duplex/Townhouse/Villa)
and/or `regionMismatch: true` (district Drochia/Ialoveni/etc.). If `jq` is unavailable,
inspect the raw JSON instead.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/queries.ts
git commit -m "feat(web): expose mislabel flags on the listings query"
```

---

## Task 4: Badges + hide toggle in the Listings UI

**Files:**
- Modify: `web/src/components/listings/ListingsTable.tsx`
- Modify: `web/src/components/ui/Toggle.tsx`
- Modify: `web/src/pages/Listings.tsx`
- Modify: `web/src/__tests__/Listings.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Append two tests to the existing `describe('Listings', …)` block in
`web/src/__tests__/Listings.test.tsx` (it mocks `apiCall`; the first arg is the endpoint):

```ts
  it('shows a mislabel badge for a flagged listing', async () => {
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({ total: 1, districts: ['Ialoveni'], price: {}, rooms: {}, areaSqm: {} });
      }
      return Promise.resolve({
        listings: [
          {
            id: '1', url: 'https://999.md/ro/1', title: 'Casă tip duplex', district: 'Ialoveni',
            priceEur: 100000, areaSqm: 100, rooms: 3, firstSeenAt: new Date().toISOString(),
            derivedType: 'Duplex', typeMismatch: true, regionMismatch: true,
            mismatchReasons: ['type: duplex', 'region: Ialoveni'],
          },
        ],
        total: 1,
      });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Duplex')).toBeInTheDocument();
    expect(await screen.findByText(/Out-of-region/)).toBeInTheDocument();
  });

  it('hides flagged listings when the hide toggle is on', async () => {
    const user = userEvent.setup();
    const { apiCall } = await import('../lib/api.js');
    (apiCall as any).mockImplementation((endpoint: string) => {
      if (endpoint.startsWith('/listings/facets')) {
        return Promise.resolve({ total: 2, districts: [], price: {}, rooms: {}, areaSqm: {} });
      }
      return Promise.resolve({
        listings: [
          { id: '1', url: 'u1', title: 'Casă bună', district: 'Durlești', priceEur: 90000, areaSqm: 90, rooms: 3, firstSeenAt: new Date().toISOString(), derivedType: 'House', typeMismatch: false, regionMismatch: false, mismatchReasons: [] },
          { id: '2', url: 'u2', title: 'Casă duplex', district: 'Durlești', priceEur: 95000, areaSqm: 95, rooms: 3, firstSeenAt: new Date().toISOString(), derivedType: 'Duplex', typeMismatch: true, regionMismatch: false, mismatchReasons: ['type: duplex'] },
        ],
        total: 2,
      });
    });

    const router = createMemoryRouter([{ path: '/', element: <Listings /> }]);
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Casă duplex')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Hide mislabeled'));
    expect(screen.queryByText('Casă duplex')).not.toBeInTheDocument();
    expect(screen.getByText('Casă bună')).toBeInTheDocument();
  });
```

Add `userEvent` to the imports at the top of the file:

```ts
import userEvent from '@testing-library/user-event';
```

- [ ] **Step 2: Run it, verify it fails**

Run: `cd web && pnpm test src/__tests__/Listings.test.tsx`
Expected: FAIL — no "Duplex"/"Out-of-region" text; no "Hide mislabeled" control.

- [ ] **Step 3: Add the fields + badges to `ListingsTable`**

Edit `web/src/components/listings/ListingsTable.tsx`. Extend `ListingsTableRow`:

```ts
export interface ListingsTableRow {
  id: string;
  url: string;
  title: string;
  district: string | null;
  priceEur: number | null;
  priceWas?: number;
  areaSqm: number | null;
  rooms: number | null;
  yearBuilt?: number;
  firstSeenAt: string;
  isNew?: boolean;
  derivedType?: 'House' | 'Villa' | 'Townhouse' | 'Duplex';
  typeMismatch?: boolean;
  regionMismatch?: boolean;
  mismatchReasons?: string[];
}
```

In the title cell (the `<div className="flex items-center gap-2 min-w-0">` block), add the
mislabel badges after the existing NEW / drop badges and before the title `<span>`:

```tsx
                    {r.isNew && <Badge variant="default">NEW</Badge>}
                    {drop !== null && drop > 0 && <Badge variant="warning">−{drop}%</Badge>}
                    {r.typeMismatch && r.derivedType && (
                      <Badge variant="warning" title={(r.mismatchReasons ?? []).join('; ')}>
                        {r.derivedType}
                      </Badge>
                    )}
                    {r.regionMismatch && (
                      <Badge variant="warning" title={(r.mismatchReasons ?? []).join('; ')}>
                        Out-of-region: {r.district ?? '?'}
                      </Badge>
                    )}
                    <span className="truncate font-medium text-neutral-800" title={r.title}>
                      {r.title}
                    </span>
```

- [ ] **Step 4: Forward `aria-label` through `Toggle`**

Edit `web/src/components/ui/Toggle.tsx`. Add `'aria-label'` to the prop type and the
`<button>`:

```tsx
export const Toggle: React.FC<{
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
  'aria-label'?: string;
}> = ({ checked, disabled, onChange, 'aria-label': ariaLabel }) => (
  <button
    type="button"
    aria-label={ariaLabel}
    disabled={disabled}
    onClick={() => onChange?.(!checked)}
```

Leave the rest of the component unchanged.

- [ ] **Step 5: Add fields, badges, toggle, and filter to `Listings.tsx`**

Edit `web/src/pages/Listings.tsx`.

(a) Extend the `Listing` interface — add after `isNew?: boolean;`:

```ts
  derivedType?: 'House' | 'Villa' | 'Townhouse' | 'Duplex';
  typeMismatch?: boolean;
  regionMismatch?: boolean;
  mismatchReasons?: string[];
```

(b) Add `Toggle` to the imports:

```ts
import { Toggle } from '@/components/ui/Toggle.js';
```

(c) Add the toggle state next to the other `useState` hooks (e.g. after the `view` state):

```ts
  const [hideMislabeled, setHideMislabeled] = useState(false);
```

(d) Derive the visible list. Immediately after `const total = data?.total ?? 0;`, add:

```ts
  const visibleListings = (data?.listings ?? []).filter(
    (l) => !hideMislabeled || !(l.typeMismatch || l.regionMismatch),
  );
```

Then replace the two render sites that iterate `data?.listings`:
- Cards: `data?.listings?.map((l) => (` → `visibleListings.map((l) => (`
- Table: change the guard `{view === 'table' && data?.listings && (` → `{view === 'table' && (`
  and `<ListingsTable rows={data.listings} …/>` → `<ListingsTable rows={visibleListings} …/>`

(e) Add the toggle control to the filter rail. Inside the filter `Card`'s
`<div className="space-y-5 text-sm">`, add a new block (after the Search block is fine):

```tsx
            <label className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                Hide mislabeled
              </span>
              <Toggle
                checked={hideMislabeled}
                onChange={setHideMislabeled}
                aria-label="Hide mislabeled"
              />
            </label>
```

(f) Add mislabel badges to `ListingCard`. In the badge row
(`<div className="flex items-center gap-1.5 mb-1">`), after the NEW/drop badges:

```tsx
          {l.typeMismatch && l.derivedType && (
            <Badge variant="warning" title={(l.mismatchReasons ?? []).join('; ')}>
              {l.derivedType}
            </Badge>
          )}
          {l.regionMismatch && (
            <Badge variant="warning" title={(l.mismatchReasons ?? []).join('; ')}>
              Out-of-region: {l.district ?? '?'}
            </Badge>
          )}
```

- [ ] **Step 6: Run the UI tests, verify pass**

Run: `cd web && pnpm test src/__tests__/Listings.test.tsx`
Expected: PASS — badges render; toggling "Hide mislabeled" removes the flagged row.

- [ ] **Step 7: Typecheck both packages**

Run: `pnpm typecheck && cd web && pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/Listings.tsx web/src/components/listings/ListingsTable.tsx web/src/components/ui/Toggle.tsx web/src/__tests__/Listings.test.tsx
git commit -m "feat(web): mislabel badges + hide toggle on Listings"
```

---

## Task 5: End-to-end verification

**Files:** none (verification + lint gate).

- [ ] **Step 1: Full test + lint + typecheck gate**

Run: `pnpm test && pnpm typecheck && pnpm lint && cd web && pnpm test && pnpm typecheck`
Expected: all green.

- [ ] **Step 2: Manual app check**

Start the crawler API and the SPA (`pnpm dev`, and `cd web && pnpm dev`). Open the Listings
page, switch to Table view, and confirm:
- Rows whose description says duplex/townhouse/villa show an amber type badge.
- Rows in non-municipality districts (Drochia, Ialoveni, …) show an "Out-of-region" badge.
- "Hide mislabeled" toggle (default OFF) hides exactly the badged rows when switched on.

Take a screenshot for the PR.

- [ ] **Step 3: (No commit)** — verification only. Proceed to opening the PR per the
  project's `feature/<slug>` → squash-merge-to-`main` convention.

---

## Self-Review notes

- **Spec coverage:** type detection (title+desc, duplex/townhouse/villa, negation guard) → Task 1/2; region district-only allowlist with î/â + ă/ș/ț folding → Task 1; villa flags as non-house → Task 1 (`typeMismatch = derivedType !== 'House'`); read-time/no-schema → Task 3; badges → Task 4; hide toggle default OFF → Task 4. Phase 2 (persist) intentionally excluded.
- **Type consistency:** `DerivedType` defined once in `listing-classification.ts`; re-exported as `ListingType`; the web duplicates the literal union (no cross-package import in this Vite app — matches the existing `ListingsTableRow` pattern).
- **No placeholders:** all code blocks are complete; the only runtime-variable value is the dev-server port in the Task 3 curl.

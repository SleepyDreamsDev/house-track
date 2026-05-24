# Mislabel Detection — Design

**Date:** 2026-05-24
**Status:** Approved (brainstorming) — pending implementation plan
**Topic:** Flag listings advertised as "house" that are actually duplex/townhouse/villa, and listings advertised in Chișinău that are actually in other regions.

## Problem

The crawl is hard-filtered to the houses-and-yards category (`subCategoryId 1406`) in
Chișinău municipality (`optionId 12900`). Two seller behaviours pollute the dataset:

1. **Type mislabel.** A listing is sold as a plain house but is really a duplex,
   townhouse, or villa — the giveaway is in the `title` or `description`, not in any
   structured field. Today `deriveType()` only inspects the *title* and only matches
   `vilă`/`townhouse`, so it misses duplexes entirely and misses description-only
   signals.
2. **Region mislabel.** A property physically in another raion (Ialoveni, Strășeni,
   Drochia…) is posted under the Chișinău location filter for visibility.

### Evidence (live DB, 448 active listings, 2026-05-24)

- **55 listings (12%)** are currently classified `House` but mention duplex/townhouse in
  title or description. Current `deriveType` misses all of them — including
  `"Casa de tip Town House"` (note the space, which `/townhouse/i` does not match).
- `title ILIKE duplex`: 36 · `description ILIKE duplex`: 47 · `title townhouse`: 72 ·
  `description townhouse`: 65 · `title vilă`: 2.
- `district` already stores the **real locality**, not a generic "Chișinău". Observed
  outsiders: Drochia, Fălești, Ialoveni, Răzeni, Cojușna, Ratuș. Observed legit
  municipality communes/villages: Bîc, Dumbrava, Cheltuitori, Brăila, Frumușica, Goian,
  Văduleni, Revaca — all separable from outsiders by an allowlist.

## Decisions

| Decision | Choice |
| --- | --- |
| Outcome | Both: store flags, show badges, **and** add a hide toggle |
| Compute location | **Hybrid** — Phase 1 read-time derivation (no schema change); Phase 2 persist columns once rules stabilize |
| Villa | Flag as a non-house type too (`typeMismatch` = derived type is not a plain `House`) |
| Region scope (v1) | **district-only** — flag purely on `district` vs allowlist; do not scan title/street yet |
| Hide toggle default | **OFF** — false positives stay visible until the rules are trusted |

## Phase 1 — read-time detection

### Component: `src/lib/listing-classification.ts` (new, pure functions)

Single source of truth for both detectors. Pure, dependency-free, unit-testable.

```ts
export type DerivedType = 'House' | 'Villa' | 'Townhouse' | 'Duplex';

export interface Classification {
  derivedType: DerivedType;
  typeMismatch: boolean;       // derivedType !== 'House'
  regionMismatch: boolean;     // district set and not in municipality allowlist
  reasons: string[];           // human-readable, e.g. ["duplex in description", "region: Drochia"]
}

export function classifyListing(input: {
  title: string;
  description: string | null;
  district: string | null;
}): Classification;
```

`deriveType()` in `src/lib/listing-type.ts` is superseded by `classifyListing`; keep the
old export as a thin wrapper (`classifyListing(...).derivedType`) so `analytics.ts` keeps
working, or migrate its one call site. Decide in the plan.

#### Type detection rules

Scan `title` **and** `description` (case-insensitive). Precedence when multiple match:
`Duplex` > `Townhouse` > `Villa` > `House`.

| Type | Pattern |
| --- | --- |
| Duplex | `/\bduplex\b/i` |
| Townhouse | `/town\s?house/i`, `/таунхаус/i` |
| Villa | `/vil[ăa]\b/i` |

`typeMismatch = derivedType !== 'House'`.

**Negative guard** — drop a match when immediately preceded (within ~15 chars) by a
negation/proximity cue, to cut "*not a duplex*" / "*next to townhouses*" false positives:
`/\b(nu\s+e(ste)?|nu\s+este|lângă|vecinătate|alături|aproape\s+de)\b/i`.
A guarded-away match falls through to the next-lower type.

#### Region detection rules

```
regionMismatch = district != null && fold(district) ∉ MUNICIPALITY_ALLOWLIST
```

- `district == null` → **not** flagged (unknown, not a known outsider).
- `fold(s)` normalizes for comparison: lowercase, strip diacritics, fold the Romanian
  pairs `î/â → i/a`, `ș/ş → s`, `ț/ţ → t` (so `Sîngera`=`Sângera`, `Bacioi`=`Băcioi`).

**`MUNICIPALITY_ALLOWLIST`** — the official Chișinău municipality (5 sectors + 6 towns +
12 communes and their villages), stored with proper diacritics, compared folded:

```
Chișinău,
Codru, Cricova, Durlești, Sîngera, Vadul lui Vodă, Vatra,        // towns
Băcioi, Brăila, Frumușica, Străisteni,                            // Băcioi commune
Bubuieci, Bîc, Humulești,                                         // Bubuieci commune
Budești, Văduleni,                                                // Budești commune
Ciorescu, Făurești, Goian,                                        // Ciorescu commune
Colonița,                                                         // Coloniţa commune
Cruzești, Ceroborta,                                              // Cruzești commune
Ghidighici,                                                       // Ghidighici commune
Grătiești, Hulboaca,                                              // Grătiești commune
Stăuceni, Goianul Nou,                                            // Stăuceni commune
Tohatin, Buneți, Cheltuitori,                                     // Tohatin commune
Trușeni, Dumbrava,                                                // Trușeni commune
Revaca                                                            // (Sîngera town)
```

Ambiguous singletons (e.g. `Dobrogea` — a Sîngerei-raion village name that occasionally
appears) are deliberately **left off** the allowlist → flagged → operator verifies via
badge. The allowlist is the single place to add a locality if a false positive appears.

### API exposure

The listings endpoint (`src/web/routes/`, the route serving the Listings page) maps each
row through `classifyListing` and adds to the response payload:
`derivedType`, `typeMismatch`, `regionMismatch`, `reasons`. No DB columns, no migration.

### UI

- **`ListingsTable`** (`web/src/components/listings/ListingsTable.tsx`): render amber
  `Badge`s (existing `web/src/components/ui/Badge.tsx`) from the new fields —
  `Duplex` / `Townhouse` / `Villa` and `Out-of-region: <district>`. Tooltip = `reasons`.
- **Hide toggle**: add a `Toggle` (existing `web/src/components/ui/Toggle.tsx`)
  "Hide mislabeled", **default OFF**. When on, filter out rows where
  `typeMismatch || regionMismatch`. Phase 1 filters **client-side** (≤3k rows).
- Keep `web/src/lib/listing-type.ts` and `src/lib/listing-type.ts` in sync, or have the
  SPA consume the API-provided fields rather than recomputing. Prefer consuming the API
  fields (single source of truth).

### Tests (`src/lib/__tests__/listing-classification.test.ts`)

Type:
- `"Casa de tip Town House"` → Townhouse (space variant).
- `таунхаус` in description → Townhouse.
- `duplex` in description only, title says `Casă` → Duplex, `typeMismatch=true`.
- Negative guard: `"nu este duplex"`, `"lângă un townhouse"` → House, `typeMismatch=false`.
- `vilă` → Villa, `typeMismatch=true`.

Region:
- `Drochia`, `Fălești`, `Ialoveni`, `Răzeni`, `Cojușna`, `Ratuș` → `regionMismatch=true`.
- `Bîc`, `Dumbrava`, `Cheltuitori`, `Brăila`, `Sângera` (folded == `Sîngera`),
  `Bacioi` (folded == `Băcioi`) → `regionMismatch=false`.
- `district=null` → `regionMismatch=false`.

## Phase 2 — persist (later)

Once the rules are trusted against real data:

1. Migration: add `typeMismatch Boolean @default(false)`, `regionMismatch Boolean
   @default(false)`, `mismatchReason String?` to `Listing` (+ index on the booleans if the
   Listings query filters on them).
2. Populate in `persistDetail` (`src/persist.ts`) by calling `classifyListing` at write
   time.
3. Backfill script (`scripts/`) to classify existing rows; must be re-run whenever a
   detection rule changes.
4. Move the hide filter to a SQL `WHERE` clause and add mismatch counts to analytics.

The Phase 1 `classifyListing` function is reused unchanged — only its call site moves from
the API read path to the persist write path.

## Out of scope (YAGNI)

- Title/street region scanning (deferred; district-only chosen for v1 precision).
- Auto-hiding or auto-deleting flagged listings (operator decides via badge/toggle).
- A configurable/DB-backed allowlist UI (hardcoded constant is fine until it churns).

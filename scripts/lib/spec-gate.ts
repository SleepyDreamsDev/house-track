// Code↔spec co-change gate. Maps source paths to the canonical SPEC-<slug>
// files that must evolve with them, so a behavioural change can't land without
// its spec being touched in the same push. Pure matching lives here; the git
// plumbing + process exit live in scripts/spec-gate.ts so this stays testable.

export interface SpecRule {
  /** Repo-relative path matcher. */
  match: RegExp;
  /** Canonical spec slug (specs/SPEC-<slug>.{md,feature}). */
  slug: string;
}

// A source file may map to several specs (e.g. parse-taxonomy feeds both
// parsing and the filter taxonomy). Touching ANY of its mapped specs satisfies
// the gate for that file — see findSpecViolations.
export const SPEC_RULES: SpecRule[] = [
  { match: /^src\/web\/routes\//, slug: 'web-api' },
  { match: /^src\/web\/(server|events|params|sweep-status|db)\.ts$/, slug: 'web-api' },
  { match: /^web\/src\//, slug: 'web-spa' },
  { match: /^src\/mcp\//, slug: 'mcp-server' },
  { match: /^src\/sources\//, slug: 'sources' },
  { match: /^prisma\//, slug: 'persistence-data-model' },
  { match: /^src\/(persist|db)\.ts$/, slug: 'persistence-data-model' },
  { match: /^src\/lib\/dedup\.ts$/, slug: 'persistence-data-model' },
  { match: /^src\/(sweep|index|circuit|fetch|log)\.ts$/, slug: 'crawl-pipeline' },
  { match: /^src\/(parse-index|parse-detail|graphql)\.ts$/, slug: 'parsing' },
  { match: /^src\/lib\/(listing-text|image-url)\.ts$/, slug: 'parsing' },
  { match: /^src\/parse-taxonomy\.ts$/, slug: 'parsing' },
  { match: /^src\/parse-taxonomy\.ts$/, slug: 'filter-taxonomy' },
  {
    match: /^src\/(config|filter-resolver|settings|taxonomy-labels)\.ts$/,
    slug: 'filter-taxonomy',
  },
  { match: /^src\/types\/filter\.ts$/, slug: 'filter-taxonomy' },
  {
    match:
      /^src\/lib\/(listing-classification|listing-type|chisinau-sector|hedonic|market-index|market-signals)\.ts$/,
    slug: 'analytics-signals',
  },
  { match: /^(Dockerfile|docker-compose\.yml)$/, slug: 'operations' },
  { match: /^scripts\/(capture-.*|verify-robots|backfill-.*)\.ts$/, slug: 'operations' },
];

const SPEC_FILE = /^specs\/SPEC-(.+?)\.(md|feature)$/;

// Tests, the specs themselves, and framework/docs dirs are never "source
// changes" that demand a spec update.
function isIgnored(file: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(file) ||
    /\.test\.[tj]sx?$/.test(file) ||
    file.startsWith('specs/') ||
    file.startsWith('.claude/') ||
    file.startsWith('docs/')
  );
}

export interface SpecViolation {
  file: string;
  /** Any one of these specs, if changed, would satisfy the gate. */
  expected: string[];
}

/** Slugs of SPEC-*.{md,feature} files present in the change set. */
export function changedSpecSlugs(changedFiles: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const f of changedFiles) {
    const m = SPEC_FILE.exec(f);
    if (m?.[1]) slugs.add(m[1]);
  }
  return slugs;
}

/** Specs a single source file maps to (deduped, empty if unmapped). */
export function specsForFile(file: string): string[] {
  const slugs = new Set<string>();
  for (const rule of SPEC_RULES) {
    if (rule.match.test(file)) slugs.add(rule.slug);
  }
  return [...slugs];
}

/**
 * Source files in the change set that map to a spec, where none of their mapped
 * specs were also changed. An empty array means the gate passes.
 */
export function findSpecViolations(changedFiles: string[]): SpecViolation[] {
  const touchedSpecs = changedSpecSlugs(changedFiles);
  const violations: SpecViolation[] = [];
  for (const file of changedFiles) {
    if (isIgnored(file)) continue;
    const expected = specsForFile(file);
    if (expected.length === 0) continue;
    if (expected.some((slug) => touchedSpecs.has(slug))) continue;
    violations.push({ file, expected });
  }
  return violations;
}

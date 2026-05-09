// Pure helpers for scripts/capture-session.ts.
//
// Anything that can be unit-tested without a live browser lives here. The
// Playwright orchestration in capture-session.ts is intentionally untested
// (mocking the browser + 999.md costs more than re-running a manual capture).

export interface ParsedArgs {
  headless: boolean;
  timeoutMs: number;
  taxonomyOp: string | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const result: ParsedArgs = { headless: false, timeoutMs: DEFAULT_TIMEOUT_MS, taxonomyOp: null };

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--headless') {
      result.headless = true;
      continue;
    }
    if (flag === '--timeout') {
      const next = argv[i + 1];
      const n = Number(next);
      if (next === undefined || !Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(`--timeout requires a positive integer (ms), got: ${String(next)}`);
      }
      result.timeoutMs = n;
      i += 1;
      continue;
    }
    if (flag === '--taxonomy-op') {
      const next = argv[i + 1];
      if (!next || !/^\w+$/.test(next)) {
        throw new Error(
          `--taxonomy-op requires an alphanumeric operation name, got: ${String(next)}`,
        );
      }
      result.taxonomyOp = next;
      i += 1;
      continue;
    }
    throw new Error(`Unknown flag: ${String(flag)}`);
  }

  return result;
}

const TAXONOMY_NAME_HINTS: readonly RegExp[] = [
  /^Search.*Filter/i,
  /^Get.*Filter/i,
  /Filter(s)?$/i,
  /Taxonomy$/i,
  /Categor(y|ies).*Filter/i,
  /Filter.*Categor(y|ies)/i,
];

// Heuristic: does this operation name look like a filter taxonomy query?
// Used to auto-pick a candidate from the discovery log when --taxonomy-op
// isn't provided.
export function looksLikeTaxonomyOpName(opName: string): boolean {
  if (opName === 'SearchAds' || opName === 'GetAdvert') return false;
  return TAXONOMY_NAME_HINTS.some((re) => re.test(opName));
}

export type HeaderClass = 'static' | 'per-request';

const PER_REQUEST_HEADER_PATTERNS: readonly RegExp[] = [
  /^cookie$/i,
  /^set-cookie$/i,
  /^authorization$/i,
  /^x-csrf-token$/i,
  /^x-xsrf-token$/i,
  /^x-request-id$/i,
  /^x-trace-id$/i,
  /-token$/i,
  /-timestamp$/i,
];

export function classifyHeader(name: string): HeaderClass {
  return PER_REQUEST_HEADER_PATTERNS.some((re) => re.test(name)) ? 'per-request' : 'static';
}

const QUERY_OPERATIONS: Record<string, string | null> = {
  SEARCH_ADS_QUERY: 'SearchAds',
  GET_ADVERT_QUERY: 'GetAdvert',
  // 999.md's filter taxonomy operation name is not known a priori — discovered
  // at capture time. Only validate that the body parses as a `query`.
  FILTER_TAXONOMY_QUERY: null,
};

export type CapturedExportName = 'SEARCH_ADS_QUERY' | 'GET_ADVERT_QUERY' | 'FILTER_TAXONOMY_QUERY';

export function replaceQueryBody(
  source: string,
  exportName: CapturedExportName,
  capturedQuery: string,
  isoTimestamp: string,
): string {
  if (!(exportName in QUERY_OPERATIONS)) throw new Error(`Unknown export: ${exportName}`);
  const expectedOp = QUERY_OPERATIONS[exportName];
  const trimmed = capturedQuery.trimStart();
  if (expectedOp !== null) {
    if (!trimmed.startsWith(`query ${expectedOp}(`)) {
      throw new Error(
        `Captured query is not a "${expectedOp}" operation — refusing to write it into ${exportName}`,
      );
    }
  } else {
    // Permissive: any `query <Name>(...)` body is acceptable.
    if (!/^query\s+\w+\s*[({]/.test(trimmed)) {
      throw new Error(
        `Captured query body does not start with \`query <Name>(\` — refusing to write it into ${exportName}`,
      );
    }
  }

  const exportRe = new RegExp(`(export const ${exportName} = \`)([\\s\\S]*?)(\`;)`, 'm');
  if (!exportRe.test(source)) {
    throw new Error(`Could not locate \`export const ${exportName} = \`...\`\` in source`);
  }

  let next = source.replace(
    exportRe,
    (_full, prefix, _body, suffix) => `${prefix}${capturedQuery}${suffix}`,
  );

  // Flip the leading // REPLACE-ME marker (if any) on the first line that
  // mentions this export. Idempotent: already-CAPTURED markers are rewritten
  // with the new timestamp rather than duplicated.
  const markerRe = new RegExp(
    `^//\\s*(REPLACE-ME[^\\n]*|CAPTURED[^\\n]*by scripts\\/capture-session\\.ts[^\\n]*)\\n(?=export const ${exportName} = \`)`,
    'm',
  );
  const newMarker = `// CAPTURED ${isoTimestamp} by scripts/capture-session.ts\n`;
  if (markerRe.test(next)) {
    next = next.replace(markerRe, newMarker);
  }

  return next;
}

export interface SearchAdsResponseLike {
  data: {
    searchAds: {
      ads: unknown[];
      count: number;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export function trimSearchAdsResponse(json: unknown, n: number): SearchAdsResponseLike {
  if (
    typeof json !== 'object' ||
    json === null ||
    !('data' in json) ||
    typeof (json as { data: unknown }).data !== 'object'
  ) {
    throw new Error('Expected JSON shape: { data: { searchAds: { ads, count } } }');
  }
  const data = (json as { data: Record<string, unknown> }).data;
  const searchAds = data['searchAds'];
  if (
    typeof searchAds !== 'object' ||
    searchAds === null ||
    !Array.isArray((searchAds as { ads?: unknown }).ads)
  ) {
    throw new Error('Expected JSON shape: { data: { searchAds: { ads, count } } }');
  }

  const trimmedSearchAds = {
    ...(searchAds as Record<string, unknown>),
    ads: (searchAds as { ads: unknown[] }).ads.slice(0, n),
  };
  return {
    ...(json as object),
    data: { ...data, searchAds: trimmedSearchAds },
  } as SearchAdsResponseLike;
}

export interface DiffResult {
  ok: boolean;
  messages: string[];
}

export function diffVariables(captured: unknown, expected: unknown): DiffResult {
  const messages: string[] = [];
  walk(captured, expected, '', messages);
  return { ok: messages.length === 0, messages };
}

function walk(captured: unknown, expected: unknown, path: string, messages: string[]): void {
  if (isPlainObject(captured) && isPlainObject(expected)) {
    const keys = new Set<string>([...Object.keys(captured), ...Object.keys(expected)]);
    for (const key of keys) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const inCaptured = key in captured;
      const inExpected = key in expected;
      if (inCaptured && !inExpected) {
        messages.push(`captured has extra field: ${childPath}`);
      } else if (!inCaptured && inExpected) {
        messages.push(`builder produces field that capture lacks: ${childPath}`);
      } else {
        walk(captured[key], expected[key], childPath, messages);
      }
    }
    return;
  }
  if (Array.isArray(captured) && Array.isArray(expected)) {
    if (captured.length !== expected.length) {
      messages.push(
        `array length differs at ${path || '<root>'}: captured=${captured.length} expected=${expected.length}`,
      );
      return;
    }
    for (let i = 0; i < captured.length; i += 1) {
      walk(captured[i], expected[i], `${path}[${i}]`, messages);
    }
    return;
  }
  if (captured !== expected) {
    messages.push(
      `value differs at ${path || '<root>'}: captured=${JSON.stringify(captured)} expected=${JSON.stringify(expected)}`,
    );
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface CookiePair {
  name: string;
  value: string;
}

export function formatCookieEnv(cookies: readonly CookiePair[]): string {
  const joined = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const escaped = joined.replace(/"/g, '\\"');
  return `BOOTSTRAP_COOKIES="${escaped}"`;
}

export function headersMarkdownTable(headers: Readonly<Record<string, string>>): string {
  const rows = Object.entries(headers)
    .map(([name, value]) => ({ name, value, klass: classifyHeader(name) }))
    .sort((a, b) => {
      if (a.klass !== b.klass) return a.klass === 'per-request' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const nameWidth = Math.max(4, ...rows.map((r) => r.name.length));
  const valueWidth = Math.max(5, ...rows.map((r) => r.value.length));
  const classWidth = 'per-request'.length;

  const pad = (s: string, w: number): string => s + ' '.repeat(Math.max(0, w - s.length));
  const lines: string[] = [];
  lines.push(
    `| ${pad('Name', nameWidth)} | ${pad('Value', valueWidth)} | ${pad('Class', classWidth)} |`,
  );
  lines.push(
    `| ${'-'.repeat(nameWidth)} | ${'-'.repeat(valueWidth)} | ${'-'.repeat(classWidth)} |`,
  );
  for (const r of rows) {
    lines.push(
      `| ${pad(r.name, nameWidth)} | ${pad(r.value, valueWidth)} | ${pad(r.klass, classWidth)} |`,
    );
  }
  return lines.join('\n');
}

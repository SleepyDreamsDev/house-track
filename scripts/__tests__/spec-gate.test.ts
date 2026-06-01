import { describe, expect, it } from 'vitest';

import {
  changedSpecSlugs,
  findSpecViolations,
  SPEC_RULES,
  specsForFile,
} from '../lib/spec-gate.js';

describe('specsForFile', () => {
  it('maps a route file to web-api', () => {
    expect(specsForFile('src/web/routes/circuit.ts')).toEqual(['web-api']);
  });

  it('maps the persistence layer and schema to persistence-data-model', () => {
    expect(specsForFile('src/persist.ts')).toEqual(['persistence-data-model']);
    expect(specsForFile('prisma/schema.prisma')).toEqual(['persistence-data-model']);
  });

  it('maps a SPA file to web-spa', () => {
    expect(specsForFile('web/src/pages/Settings.tsx')).toEqual(['web-spa']);
  });

  it('maps parse-taxonomy to BOTH parsing and filter-taxonomy', () => {
    expect(specsForFile('src/parse-taxonomy.ts').sort()).toEqual(['filter-taxonomy', 'parsing']);
  });

  it('returns no specs for an unmapped file', () => {
    expect(specsForFile('src/smoke-assertions.ts')).toEqual([]);
    expect(specsForFile('README.md')).toEqual([]);
  });
});

describe('changedSpecSlugs', () => {
  it('extracts slugs from SPEC md + feature files', () => {
    const slugs = changedSpecSlugs([
      'specs/SPEC-web-api.md',
      'specs/SPEC-persistence-data-model.feature',
      'src/persist.ts',
    ]);
    expect([...slugs].sort()).toEqual(['persistence-data-model', 'web-api']);
  });

  it('ignores non-SPEC feature files', () => {
    expect([...changedSpecSlugs(['specs/sweep.feature'])]).toEqual([]);
  });
});

describe('findSpecViolations', () => {
  it('flags source changed without its spec', () => {
    const v = findSpecViolations(['src/web/routes/listings.ts']);
    expect(v).toEqual([{ file: 'src/web/routes/listings.ts', expected: ['web-api'] }]);
  });

  it('passes when the matching spec is changed too', () => {
    expect(findSpecViolations(['src/web/routes/listings.ts', 'specs/SPEC-web-api.md'])).toEqual([]);
  });

  it('passes when any ONE of a multi-mapped file’s specs is changed', () => {
    expect(findSpecViolations(['src/parse-taxonomy.ts', 'specs/SPEC-parsing.feature'])).toEqual([]);
  });

  it('ignores test files, the specs themselves, docs, and .claude', () => {
    expect(
      findSpecViolations([
        'src/web/routes/__tests__/circuit.test.ts',
        'src/persist.test.ts',
        'specs/SPEC-web-api.md',
        'docs/poc-spec.md',
        '.claude/progress.md',
      ]),
    ).toEqual([]);
  });

  it('reports multiple independent violations', () => {
    const v = findSpecViolations(['src/sweep.ts', 'src/mcp/server.ts']);
    expect(v.map((x) => x.file).sort()).toEqual(['src/mcp/server.ts', 'src/sweep.ts']);
  });

  it('every rule slug has a real SPEC file convention (slug is kebab, non-empty)', () => {
    for (const rule of SPEC_RULES) {
      expect(rule.slug).toMatch(/^[a-z][a-z-]*[a-z]$/);
    }
  });
});

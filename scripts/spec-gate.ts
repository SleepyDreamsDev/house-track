// Pre-push gate: refuse a push whose source changes don't carry a matching
// canonical SPEC-<slug> edit. Bypass a commit with [skip-spec] in its message
// (genuine no-op refactors). Run manually with `pnpm spec:gate`.
//
// Reads the git pre-push protocol on stdin (lines of
// "<local-ref> <local-sha> <remote-ref> <remote-sha>"); falls back to
// origin/main...HEAD when invoked by hand. Fails open on git errors so an
// environment quirk never blocks a legitimate push — the gate is a guard
// rail, not a tripwire.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { findSpecViolations } from './lib/spec-gate.js';

const ZERO = '0'.repeat(40);
const SKIP_TAG = '[skip-spec]';

// execFile (no shell): refs/SHAs come from stdin, so never interpolate them
// into a shell string.
function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

function lines(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

interface Range {
  base: string;
  tip: string;
}

function rangesFromStdin(): Range[] {
  let raw = '';
  try {
    if (process.stdin.isTTY) return [];
    raw = readFileSync(0, 'utf8');
  } catch {
    return [];
  }
  const ranges: Range[] = [];
  for (const line of lines(raw)) {
    const [, localSha, , remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO) continue; // branch deletion / malformed
    ranges.push({ base: remoteSha ?? ZERO, tip: localSha });
  }
  return ranges;
}

function spec({ base, tip }: Range): string {
  return base === ZERO || !base ? `origin/main..${tip}` : `${base}..${tip}`;
}

function changedFiles(ranges: Range[]): string[] {
  const files = new Set<string>();
  const specs = ranges.length ? ranges.map(spec) : ['origin/main...HEAD'];
  for (const s of specs) {
    for (const f of lines(git(['diff', '--name-only', s]))) files.add(f);
  }
  return [...files];
}

function commitMessages(ranges: Range[]): string {
  const specs = ranges.length ? ranges.map(spec) : ['origin/main...HEAD'];
  return specs.map((s) => git(['log', '--format=%B', s])).join('\n');
}

function main(): void {
  const ranges = rangesFromStdin();

  let files: string[];
  let messages: string;
  try {
    files = changedFiles(ranges);
    messages = commitMessages(ranges);
  } catch (err) {
    console.warn(
      `spec-gate: could not compute push range (${(err as Error).message.split('\n')[0]}); skipping.`,
    );
    return; // fail open
  }

  if (messages.includes(SKIP_TAG)) {
    console.warn(`spec-gate: ${SKIP_TAG} found in a commit message — skipping spec check.`);
    return;
  }

  const violations = findSpecViolations(files);
  if (violations.length === 0) return;

  console.error('\n✖ spec-gate: source changed without its canonical spec.\n');
  for (const v of violations) {
    const specs = v.expected.map((s) => `specs/SPEC-${s}.{md,feature}`).join(' or ');
    console.error(`  • ${v.file}\n      → update ${specs}`);
  }
  console.error(
    `\nThe spec is the source of intent — evolve it in the same commit as the code.` +
      `\nGenuine no-op refactor? Add ${SKIP_TAG} to a commit message in this push.\n`,
  );
  process.exit(1);
}

main();

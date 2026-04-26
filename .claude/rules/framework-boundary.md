# Framework Boundary Rule

> Framework-generic. Ships with claude-tdd-starter.
> Read this before modifying ANY file in `.claude/hooks/`, `.claude/skills/`, or `.claude/agents/`.

---

## The Two Layers

Every `.claude/` directory has two layers:

1. **Framework files** — generic TDD pipeline infrastructure (hooks, skills, agents, rules).
   Owned by claude-tdd-starter. Listed in `.claude/framework-manifest.json` under `"framework"`.
2. **Project files** — project-specific customizations (design system rules, i18n agents, skill overrides).
   Listed in `.claude/framework-manifest.json` under `"project"`.

**Before touching any `.claude/` file, check `framework-manifest.json` to determine which layer it belongs to.**

---

## Rules for Framework Files

When modifying a file listed under `"framework"` in `framework-manifest.json`:

- **No hardcoded project values.** Never write a project name, package manager command, file path,
  or agent name directly. Use `_var()` lookups in hooks or `Read .claude/framework.json` in agents/skills.
- **No project-specific logic inline.** If a skill needs project-specific behavior, add it to the
  corresponding `PROJECT_OVERRIDES.md` file in the same skill directory — not to `SKILL.md` itself.
- **Stay generic.** The file must work for any project using claude-tdd-starter
  (Next.js, Express, Go, Python, etc.).
- **Self-check before saving:** grep the file for project-specific strings (project name, `pnpm`, hardcoded paths).
  If found, move them to `framework.json` or `PROJECT_OVERRIDES.md`.

---

## Rules for Project Files

When modifying a file listed under `"project"` in `framework-manifest.json`:

- These are yours — no restrictions beyond normal project coding rules.
- If your change would benefit ALL projects using the starter, propose moving it to the framework layer instead.

---

## Adding New Files

New hooks, skills, agents, or rules: decide at creation time whether they are framework or project.
Add the path to the correct section of `framework-manifest.json` immediately.

---

## Tooling Protection

Framework files must stay byte-identical for `framework-sync.sh` to work — that means
project-level **tooling** (auto-formatters, linters, codemods) must not rewrite them
either. The bug class to prevent: an innocent `pnpm format` reflows whitespace in
`.claude/skills/feature/SKILL.md`, the file drifts from the upstream, and the next
`framework-sync.sh pull` shows a confusing diff.

Every project scaffolded from this starter MUST exclude framework directories from
its formatter and linter ignore files. The canonical list:

```
.claude/
docs/
```

Concretely:

- `.prettierignore` — must include the block above. `setup.sh` scaffolds a
  default `.prettierignore` (from `core/.prettierignore.template`) when one is
  not already present. Do not strip the framework-protection block.
- `.eslintignore` (or the `ignores` block in `eslint.config.js`) — same.
  Lint plugins should not enforce style rules on `.claude/**/*.md`.
- Any other auto-fix tooling (codemods, `markdownlint --fix`, stylelint, etc.)
  — same rule.

If a project has a legitimate reason to format a file inside `.claude/` (for
example, a hand-maintained `.claude/progress.md`), exclude it explicitly in
`framework-manifest.json` under `"project"` and ALSO in the formatter's
allow-list — don't widen the formatter to all of `.claude/`.

---

## Runtime Variable Resolution

### In hooks (bash scripts)

```bash
VARS="$CLAUDE_PROJECT_DIR/.claude/framework.json"
_var() { jq -r ".$1" "$VARS" 2>/dev/null; }

# Usage:
$(_var TYPECHECK_CMD)          # e.g. pnpm type-check
$(_var FORMAT_CMD) "$FILE"     # e.g. pnpm prettier --write
$(_var PROJECT_NAME)           # e.g. forever-clean
```

### In agents and skills (markdown instructions)

Add this at the top of the agent/skill instructions:

```
Read .claude/framework.json — use its values for TYPECHECK_CMD, TEST_CMD,
PROJECT_NAME, and other project variables throughout this task.
```

---

## PROJECT_OVERRIDES.md Pattern

Skills that need project-specific behavior use a two-file pattern:

- `SKILL.md` — generic TDD pipeline (plan lookup, agent dispatch, RED/GREEN/REFACTOR).
  Contains: `Read .claude/skills/<name>/PROJECT_OVERRIDES.md if it exists` at extension points.
- `PROJECT_OVERRIDES.md` — project-specific additions (planning agent instructions,
  security checks, reviewer context, doc update steps).

SKILL.md says which sections it reads from PROJECT_OVERRIDES.md. The file contains
clearly labeled `## <Section Name>` headings that SKILL.md references by name.

---

## Syncing with claude-tdd-starter

Framework files should be byte-identical between this project and
`claude-tdd-starter/core/.claude/`. After improving a framework file here, run:

```bash
<starter-repo>/framework-sync.sh push <this-project-dir>
```

To pull framework improvements from the starter:

```bash
<starter-repo>/framework-sync.sh pull <this-project-dir>
```

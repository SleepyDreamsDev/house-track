# Claude TDD Starter — Framework Architecture

> Single reference document describing the full approach, capabilities, and design decisions.
> Last updated: 2026-04-05.

---

## Philosophy

This framework treats Claude Code as an autonomous development engine, not a chat assistant. The goal: hand Claude a feature description and get back production-grade code with tests, security review, and a clean commit — with minimal human intervention.

Three principles drive every design decision:

1. **Discipline through structure.** TDD phases (RED/GREEN/REFACTOR) are enforced by the skill, not by willpower. Claude cannot skip tests or ship unrefactored code.
2. **Trust but verify.** Specialist agents write code autonomously, but the reviewer agent and security gate validate before anything ships. Hooks enforce formatting and type safety on every file edit.
3. **Framework-agnostic core, stack-specific presets.** The TDD workflow, hooks, and quality gates work with any language or framework. Stack specifics (test commands, agents, security patterns) live in presets.

---

## Architecture Overview

```
claude-tdd-starter/
├── core/                    # Framework-agnostic (always copied to target)
│   ├── .claude/
│   │   ├── settings.json    # Hooks + permissions + plugin overrides
│   │   ├── hooks/           # 7 automated hooks
│   │   ├── skills/          # /feature and /security orchestration
│   │   ├── agents/          # Reviewer agent (template)
│   │   ├── rules/           # TDD workflow, session reporting, plugin gate
│   │   └── plans/           # Backlog template + plans docs
│   ├── .husky/              # Git hooks (pre-commit, commit-msg, pre-push)
│   ├── specs/               # Gherkin output directory
│   └── docs/                # Reference guides (this file, TDD guide, SDLC blueprint)
├── presets/                  # Stack-specific configurations
│   ├── nextjs/              # Next.js + App Router
│   ├── express-simple/      # Express + TypeScript
│   ├── nestjs-react-monorepo/  # NestJS + React (with specialist agents)
│   └── react-capacitor/     # React + Capacitor (with specialist agents)
└── setup.sh                 # One-command installation
```

### How Setup Works

`setup.sh` copies `core/` into your project, selects a preset, and replaces `{{PLACEHOLDERS}}` with stack-specific values (test commands, lint config, agent definitions, security patterns). The result: a fully configured `.claude/` directory tailored to your stack.

---

## The Skill System

### `/feature [--careful] <description>` — Orchestrated TDD Delivery

The `/feature` skill is the heart of the framework. It drives Claude through 7 phases autonomously:

```
PHASE 0: PLAN     — Load plan context, determine FAST/CAREFUL mode
PHASE 1: DISCOVER — Read codebase, detect workspace domains, find patterns
PHASE 1.5: SPECIFY — Write Gherkin acceptance criteria (documentation-only)
    ↓
    [FAST_MODE: auto-approve | --careful: user reviews scenarios]
    ↓
PHASE 2: RED      — Write failing tests (one it() per Gherkin scenario)
PHASE 3: GREEN    — Write simplest code to make tests pass
PHASE 4: REFACTOR — Improve code quality, one change at a time
PHASE 5: SHIP     — Validate → review → security → commit → Kaizen
```

#### FAST_MODE vs --careful

**FAST_MODE (default):** Combined RED+GREEN in one pass, auto-approved Gherkin specs. No pauses. Use for routine features where the spec is clear.

**--careful mode:** Separate RED and GREEN phases with a pause after SPECIFY for the user to review scenarios. Use for complex features, unfamiliar domains, or when scope is uncertain.

#### Phase 5: SHIP — The Quality Pipeline

SHIP is where all quality gates execute in sequence:

1. **Validation:** Run typecheck + tests in parallel
2. **Reviewer gate:** Dispatch the reviewer agent
   - CSS/presentation-only changes → light review (skip OWASP, check responsive logic)
   - Logic changes → full review (type safety, input validation, OWASP, data exposure)
3. **Security gate:** Auto-invoke `/security` if auth, crypto, or sync files were modified (patterns configurable per preset)
4. **Copilot review gate:** Wait up to 60s for GitHub Copilot review findings, triage by severity:
   - Bug/security/correctness → fix before merging
   - Style/suggestion → fix if trivial, otherwise note
   - Scope/docs → note in PR, skip fix
5. **Commit + push:** Conventional commit message, branch creation
6. **Backlog update:** Mark completed items with `[x]` in `backlog.md`
7. **Kaizen retrospective:** Evaluate what went well/poorly, auto-implement fixes, surface workflow suggestions
8. **Starter sync check:** Flag framework improvements to backport to claude-tdd-starter

### `/security [files or git ref]` — Deep Security Review

4-phase security analysis:

1. **SCOPE:** Determine files to review (from arguments or git diff)
2. **THREAT MODEL:** Classify changes into threat categories (auth bypass, injection, SSRF, etc.)
3. **REVIEW:** Check OWASP Top 10 + platform-specific threats (configurable per preset)
4. **REPORT:** Output severity-rated findings (CRITICAL/HIGH/MEDIUM/LOW)
5. **FIX:** Apply fixes for CRITICAL+HIGH findings (pause for confirmation), run tests

---

## The Hook System

Hooks run automatically on every tool use — no human intervention needed.

### Pre-Tool Hooks (before Claude acts)

| Hook | Trigger | Purpose |
|------|---------|---------|
| `block-dangerous.sh` | Before any Bash command | Blocks 16 dangerous patterns: rm -rf on system paths, force push to main, DROP TABLE, git RCE vectors, Docker privileged mode, host root mounts, sed command execution, find -exec, curl piped to shell, wget, .env file reading, node/python shell escapes |
| `auto-approve-plan.sh` | On ExitPlanMode | Auto-approves plan exits for fully autonomous plan→execute flows |

### Post-Tool Hooks (after Claude edits a file)

| Hook | Trigger | Purpose |
|------|---------|---------|
| `format-on-write.sh` | After Edit/Write | Runs Prettier (or configured formatter) on the edited file. Skips `*/generated/*` directories |
| `typecheck-on-edit.sh` | After editing .ts/.tsx | Runs TypeScript type check (non-blocking — Claude sees errors and fixes them) |
| `style-audit.sh` | After editing .tsx/.jsx | Warns on anti-patterns: hardcoded hex colors, inline fontFamily, hardcoded px spacing. Non-blocking |

### Lifecycle Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| `notify.sh` | Notification + Stop | Desktop notification (macOS/Linux/Windows) when Claude needs attention |
| `stop-reminder.sh` | Stop | Displays session checklist: backlog updated? tests passing? types clean? framework improvements to sync? |

### Hook Design Principles

- **Non-blocking by default.** Hooks exit 0 even on warnings — they inform Claude, they don't block it. Only `block-dangerous.sh` can block (exit 2).
- **Framework-agnostic paths.** Hooks use `$CLAUDE_PROJECT_DIR` for portability across projects.
- **Configurable via setup.sh.** Format commands, file extensions, and type-check commands are preset-specific placeholders filled during setup.

---

## The Rules System

Rules in `.claude/rules/` are auto-loaded into every conversation. They define invariant behavior Claude must follow.

### `tdd-workflow.md` — TDD Discipline

- Never write implementation and tests in the same step
- RED: failing tests only. GREEN: simplest passing code. REFACTOR: improve without breaking
- If a test fails during REFACTOR, revert immediately
- Testing Trophy priority: integration > unit > edge cases > E2E
- Coverage target: 70%+ on business logic
- Each Gherkin `Scenario:` maps to one `it()` block (AAA pattern)
- Escape hatch: if stuck 3+ times on the same failure, re-read errors before escalating

### `session-reporting.md` — Observability

Structured reporting throughout the session:
- Before each file edit: one-line summary of what and why
- After each bash command: success/fail + one-line result
- Phase banners when entering RED/GREEN/REFACTOR/SHIP
- Completion summary (bordered block with spec, tests, branch, commit, files, assumptions)
- Kaizen retrospective (classify improvements: fix/quality → auto-implement, workflow/architecture → output only)

### `plugin-gate.md` — Token Optimization

Maps disabled plugins to their trigger conditions. Claude checks this before starting work and notifies the user when a task would benefit from a plugin that's currently disabled for token savings.

---

## The Agent System

### Reviewer Agent (always present)

The reviewer is an Opus-model read-only agent that validates at SHIP phase:
- Runs typecheck + tests
- Checks type safety (no `any`, proper error handling)
- Reviews OWASP Top 10 vulnerabilities
- Verifies input validation, auth guards, access control
- Checks for injection, data exposure, error leakage
- Reports findings as CRITICAL/HIGH/MEDIUM/LOW

The reviewer **cannot edit code** — it reports findings to the lead agent, which applies fixes.

### Specialist Agents (preset-dependent)

Multi-domain presets (nestjs-react-monorepo, react-capacitor) define scoped specialist agents:

| Preset | Agents | Model | Scope |
|--------|--------|-------|-------|
| nestjs-react-monorepo | backend-dev, frontend-dev, infra-agent | Sonnet | Scoped to specific directories |
| react-capacitor | ui-dev, data-dev | Sonnet | Scoped to UI vs data layer |
| nextjs | none (inline execution) | — | — |
| express-simple | none (inline execution) | — | — |

**Agent coordination:** For cross-cutting features, data-layer agents run first (build foundations), then UI agents consume the data layer. Agent teams require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

---

## Token Optimization

### The Problem

Claude Code plugins inject skill descriptions, agent types, MCP tools, and system instructions into **every conversation turn** — even when not used. A typical setup with 18 plugins adds ~14,000-17,000 tokens/turn of system context before you type anything.

### The Solution: Project-Level Plugin Management

Disable unused plugins at the project level in `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "atlassian@claude-plugins-official": false,
    "sentry@claude-plugins-official": false,
    "greptile@claude-plugins-official": false
  }
}
```

Project-level `false` overrides global `true`. Each project enables only what it needs.

### Plugin Gate Rule

The `plugin-gate.md` rule maps each disabled plugin to its trigger condition. Claude reads this at session start and notifies the user: *"This task would benefit from the `sentry` plugin."*

### Optimization Layers

| Layer | Action | Savings |
|-------|--------|---------|
| Plugin management | Disable unused plugins per project | ~15-30% per turn |
| Effort level | Default `"medium"`, escalate for features | ~15-25% on routine turns |
| Model switching | Sonnet for simple tasks, Opus for features | ~5-10x cheaper on simple turns |
| Session hygiene | New session per feature, `/clear` on context switches | ~15-20% per session |
| Agent discipline | Avoid parallel dispatches for <3 independent tasks | ~25K tokens per avoided dispatch |

---

## The Plans System

### Backlog (`backlog.md`)

A prioritized task list in `.claude/plans/`. The `/feature` skill auto-updates completed items with `[x]` markers after shipping.

### Feature Plans

Any `.md` file in `.claude/plans/` can serve as a feature spec. `/feature` loads the most recent plan automatically in PHASE 0, using it as the source of truth for scope and acceptance criteria.

### Plan Mode Integration

The `auto-approve-plan.sh` hook enables fully autonomous plan→execute flows. Claude exits plan mode without the interactive picker, proceeding directly to implementation.

---

## Git Integration

### Husky Git Hooks

| Hook | Action |
|------|--------|
| `pre-commit` | lint-staged (ESLint + Prettier on staged files) |
| `commit-msg` | commitlint (enforces conventional commits) |
| `pre-push` | TypeScript check + full test suite |

### Conventional Commits

Enforced by commitlint: `type(scope): description`

Types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`

### Branch Convention

Feature: `feature/short-description` | Fix: `fix/issue-description`
Squash merge to main, delete after merge.

---

## Gherkin Specs

Written in PHASE 1.5 (SPECIFY) before any tests. These are **documentation-only** — no Cucumber dependency, no executable step definitions. They serve as:

1. Human-readable acceptance criteria
2. Direct mapping to test cases (one `Scenario:` → one `it()`)
3. Scope boundaries — what's in and what's out of the feature
4. Communication artifact — shareable with non-technical stakeholders

Specs live in `specs/*.feature`, one file per feature/PR.

---

## Kaizen Retrospective

After every `/feature` delivery, the skill evaluates the session:

```
── KAIZEN ──────────────────────────────────────
  What went well:
    - <1-2 things>
  What could improve:
    - <1-2 concrete, actionable suggestions>
  Auto-implemented:
    - <Fix/Quality improvements applied, or "none">
  Workflow delta (not auto-implemented):
    - <Workflow/Architecture suggestions, or "none">
────────────────────────────────────────────────
```

Classification rules:
- **Fix / Quality** → auto-implement + commit (stale code, type improvements, dead imports)
- **Workflow / Architecture** → output only, do not auto-implement (framework changes need human judgment)

### Starter Sync Check

The final step of Kaizen checks if any framework improvements should be backported to claude-tdd-starter. This keeps the starter evolving with learnings from real project usage.

---

## Preset System

Presets customize the framework for specific tech stacks without modifying the core.

### Preset Structure

```
presets/my-stack/
  preset.json           # Variables: test commands, scopes, format config, agents
  CLAUDE.md.partial     # Stack-specific CLAUDE.md sections
  feature-overrides.md  # Workspace detection, test patterns, agent dispatch, security
  agents/               # Specialist agent definitions (optional)
```

### Key Variables (`preset.json`)

| Variable | Purpose | Example |
|----------|---------|---------|
| `TYPECHECK_CMD` | Type check command | `pnpm tsc --noEmit` |
| `TEST_CI_CMD` | Full test suite for CI | `pnpm vitest run` |
| `FORMAT_CMD` | Formatter command | `prettier --write` |
| `FORMAT_EXTENSIONS` | File patterns to format | `*.ts,*.tsx,*.json,*.css` |
| `HAS_AGENTS` | Whether to use specialist agents | `true` / `false` |
| `PACKAGE_MANAGER` | Package manager | `pnpm` / `npm` / `bun` |

### Creating a New Preset

1. Copy an existing preset directory
2. Update `preset.json` with your stack's commands
3. Write `CLAUDE.md.partial` with stack-specific architecture and conventions
4. Write `feature-overrides.md` with workspace detection, test patterns, and security checks
5. Add specialist agents if your stack has multiple domains
6. Run `./setup.sh my-stack` to test

---

## Security Model

### Defense in Depth

```
Layer 1: block-dangerous.sh     — Prevents catastrophic commands before execution
Layer 2: format-on-write.sh     — Enforces consistent code style automatically
Layer 3: typecheck-on-edit.sh   — Catches type errors immediately
Layer 4: style-audit.sh         — Warns on anti-patterns (non-blocking)
Layer 5: pre-commit hook        — ESLint + Prettier on staged files
Layer 6: commit-msg hook        — Conventional commit format enforcement
Layer 7: pre-push hook          — Full typecheck + test suite before push
Layer 8: Reviewer agent         — OWASP Top 10 review at SHIP phase
Layer 9: Security gate          — Auto-invoke /security for sensitive files
Layer 10: Copilot review gate   — GitHub Copilot automated review
```

### What `block-dangerous.sh` Blocks (16 patterns)

1. `rm -rf` on system/parent paths
2. `git push --force` to main/master
3. `git --upload-pack` (RCE vector)
4. `DROP DATABASE/TABLE`
5. `prisma migrate reset`
6. `docker compose down -v` (volume destruction)
7. Privileged Docker containers
8. Docker host root mounts
9. `sed` with `e` flag (command execution)
10. `find -exec` (arbitrary command execution)
11. `curl` download to file
12. `curl` piped to shell
13. `wget`
14. Direct `.env` file reading
15. `node` child_process escape
16. `python` subprocess escape

---

## Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| v1 | 2026-03 | Initial template: 3 presets, TDD skill, hooks |
| v2 | 2026-03 | Gherkin specs, FAST_MODE, specialist agents, react-capacitor preset |
| v2.1 | 2026-03 | Copilot review gate (Step 4.5) in /feature skill |
| v2.2 | 2026-04 | Plugin gate rule, token optimization patterns, framework architecture doc |

# Solo Developer SDLC Blueprint: Local-First, Production-Grade from Day One

**Goal:** Set up a complete local development lifecycle — testing, CI/CD, security, Docker — that produces production-quality output from the first commit. Hosting is Phase 2.

---

## Part 1: The Local-First Stack

Every tool here runs on your machine or in a local Docker container. You ship production-grade code before you ever buy a server.

### Core Stack

| Layer               | Tool                                        | Why                                                                |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| **Framework**       | Next.js 15+ (App Router)                    | Full-stack React, SSR/SSG, API routes, massive ecosystem           |
| **Language**        | TypeScript (strict mode)                    | Type safety is the single biggest solo-dev productivity multiplier |
| **Styling**         | Tailwind CSS v4 + shadcn/ui                 | Utility-first CSS with accessible component primitives             |
| **Database**        | PostgreSQL (Docker local → Neon production) | Run Postgres in Docker locally; Neon serverless for prod           |
| **ORM**             | Drizzle ORM                                 | SQL-first, TypeScript-native, no codegen step, 7.4kb               |
| **Auth**            | Better Auth                                 | Open-source, TS-first. Auth.js team joined Better Auth Sept 2025   |
| **API**             | tRPC + Server Actions                       | Full type inference backend→frontend                               |
| **Validation**      | Zod                                         | TypeScript-first schema validation                                 |
| **Package manager** | pnpm                                        | Fastest installs, disk-efficient                                   |

### Development Environment

| Tool                | Purpose                                               |
| ------------------- | ----------------------------------------------------- |
| **VS Code**         | Primary IDE with extensions below                     |
| **Docker Desktop**  | Local Postgres, Redis, any service dependency         |
| **Claude Code**     | AI-powered development, git operations, PR review     |
| **GitHub Spec Kit** | Spec-driven development workflow                      |
| **Git + GitHub**    | Version control, CI/CD via Actions, security scanning |

### VS Code Extensions (Essential)

Install these day one:

- **ESLint** + **Prettier** — code quality and formatting
- **Tailwind CSS IntelliSense** — class autocomplete
- **Prisma/Drizzle** — schema highlighting (use Drizzle extension)
- **Docker** — container management from VS Code
- **GitLens** — git history and blame
- **Error Lens** — inline error display
- **Thunder Client** or **REST Client** — API testing
- **GitHub Actions** — workflow syntax highlighting
- **Claude Code** extension (if available) or use terminal

---

## Part 2: Docker as Your Local Infrastructure

Docker replaces "works on my machine" with reproducible environments. You don't need Docker for the Next.js app itself during development (use `pnpm dev`), but you need it for services.

### docker-compose.yml (Local Development)

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: devpass
      POSTGRES_DB: myapp
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

### Dockerfile (Production Build)

Create this day one — it's what Coolify/Hetzner will use later:

```dockerfile
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
```

Add to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  output: "standalone", // Required for Docker deployments
};
```

### Docker Workflow

```bash
# Start local services
docker compose up -d

# Verify Postgres is ready
docker compose exec postgres pg_isready

# Run your app against local Docker services
DATABASE_URL="postgresql://dev:devpass@localhost:5432/myapp" pnpm dev

# Test production Docker build locally
docker build -t myapp .
docker run -p 3000:3000 --env-file .env.production.local myapp
```

---

## Part 3: GitHub Spec Kit — Spec-Driven Development

Spec Kit is GitHub's open-source toolkit that replaces "vibe coding" with structured, verifiable AI-driven development. It works with Claude Code, Copilot, Gemini CLI, Cursor, and others. The workflow: **specify → plan → tasks → implement**.

### Installation

```bash
# Install the Specify CLI
uvx --from git+https://github.com/github/spec-kit.git specify init .  --ai claude
```

This scaffolds `.github/agents/` with custom commands (slash commands) for your chosen AI agent.

### The Four-Phase Workflow

**Phase 1 — Constitution:** Define immutable principles governing how specs become code. Run once per project. The AI analyzes your codebase and generates a `constitution.md`.

**Phase 2 — Specify (`/specify`):** Describe WHAT and WHY. The AI generates a full specification with acceptance criteria, constraints, and edge cases. You review and refine.

**Phase 3 — Plan (`/plan`):** Declare architecture, stack, constraints. The AI proposes a technical implementation plan respecting your patterns.

**Phase 4 — Tasks (`/tasks`):** The AI breaks the plan into small, reviewable, independently testable units. Then `/implement` executes each task.

### Integrating Spec Kit with Claude Code

Claude Code is a first-class supported agent. After `specify init`, use Spec Kit's commands directly in Claude Code sessions:

```bash
# In Claude Code terminal
claude "Read the spec in .spec/ and implement the next task. Follow the plan."
```

The key insight from practitioners: **the spec survives tool switching**. Write it once, use it across Claude Code, Copilot, Cursor — the shared context stays consistent.

### When Spec Kit Adds Value vs. Overhead

**Use Spec Kit for:**

- New features with multiple moving parts
- Brownfield changes to existing codebases
- Anything where "building the wrong thing" is the real risk

**Skip Spec Kit for:**

- Quick bug fixes
- Styling changes
- One-file utilities

---

## Part 4: Claude Code as Your Development Engine

### CLAUDE.md — The Most Important File

```markdown
# MyApp

## Tech Stack

- Next.js 15, TypeScript strict, Tailwind CSS v4, Drizzle ORM, PostgreSQL
- Better Auth for authentication, tRPC for API layer, Zod for validation
- Docker for local services, pnpm for package management

## Commands

- Dev: `pnpm dev` | Build: `pnpm build` | Test: `pnpm test`
- Lint: `pnpm lint` | Type-check: `pnpm typecheck`
- DB migrate: `pnpm db:migrate` | DB push: `pnpm db:push`
- Docker up: `docker compose up -d`

## Conventions

- Conventional Commits: feat(scope): description
- Feature branches: feature/short-description, fix/short-description
- Squash merge to main, delete branch after merge
- Vitest for testing, Playwright for E2E
- All API routes must have integration tests
- Use Server Actions for mutations, tRPC for queries

## Architecture

- /src/app — Next.js App Router pages and layouts
- /src/server — tRPC routers, database queries, business logic
- /src/components — React components (shadcn/ui based)
- /src/lib — Shared utilities, Drizzle schema, auth config

## Lessons Learned

(Claude Code appends here as issues arise)
```

### The Anthropic-Recommended Workflow

Anthropic's own engineering teams follow this four-step pattern:

1. **Research first:** `claude "Investigate the auth module. What patterns are used? What tests exist?"`
2. **Plan:** `claude "Create a detailed plan for adding password reset. Use plan mode."`
3. **Implement:** `claude "Implement step 1 of the plan. Run tests after."`
4. **Commit:** `claude "Commit with conventional commit message and create a PR."`

### Claude Code + Git Integration

Anthropic reports 90%+ of their git interactions go through Claude Code. Key commands:

```bash
# Start in plan mode (Shift+Tab) for complex changes
claude --plan "Implement user authentication with Better Auth"

# Headless mode for CI/CD pipelines
claude -p "Review this diff for security issues" --output-format json

# Compact when context gets stale
/compact Focus on the auth module and API routes
```

### Claude Code Hooks (Automate Quality Gates)

Configure in `.claude/settings.json`. See the companion guide `claude-code-hooks-and-tdd-guide.md` for full setup instructions, all hook scripts, and the intervention map.

**Decisions:** No auto-test on Stop (explicit only). Full monorepo type check. Formatter skips `*/generated/*`. Blocks include `prisma migrate reset` and `docker compose down -v`.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/block-dangerous.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-write.sh",
            "timeout": 30
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/typecheck-on-edit.sh",
            "timeout": 60
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

### TDD with Claude Code

See `claude-code-hooks-and-tdd-guide.md` for the full implementation — skill file, hook scripts, and setup instructions.

**One command drives the whole cycle:**

```
/feature password reset — create tokens, validate expiry, prevent enumeration
```

Claude autonomously runs: DISCOVER → RED (write tests) → **pause for your review** → GREEN (implement until pass) → REFACTOR (improve, stay green) → SHIP (commit, PR, checkpoint).

**Three layers work together:**

- **CLAUDE.md** — always-on rules (TDD conventions, commit format, what not to do)
- **`/feature` skill** — multi-phase workflow Claude follows end-to-end
- **Hooks** — deterministic quality gates on every file edit (format, typecheck, block dangerous commands)

**Your total input per feature:** the description + "go" after reviewing the test list + merge the PR. Everything between is automatic.

---

## Part 5: Git Workflow — Trunk-Based Development

### Branch Strategy

Google's DORA research is unequivocal: teams with fewer than three active branches achieve highest delivery performance. Even GitFlow's creator now recommends simpler workflows for continuous delivery.

**The workflow:** `main` is always deployable and protected. Short-lived feature branches (hours to 1-2 days max). PRs even as a solo dev. Squash-merge. Delete branch.

### Branch Naming Convention

Format: `<type>/<short-description>` — lowercase, hyphens only.

| Prefix      | Use                           |
| ----------- | ----------------------------- |
| `feature/`  | New functionality             |
| `fix/`      | Bug fixes                     |
| `hotfix/`   | Urgent production fixes       |
| `refactor/` | Code restructuring            |
| `chore/`    | Tooling, dependencies, config |
| `docs/`     | Documentation                 |
| `test/`     | Test additions/changes        |

Examples: `feature/password-reset`, `fix/login-redirect-loop`, `chore/update-deps`

### Conventional Commits (Mandatory)

Format: `<type>(scope): <description>`

```
feat(auth): add JWT-based login flow
fix(api): prevent null pointer on missing user data
chore(deps): update drizzle-orm to 0.35.0
docs(readme): add local development setup instructions
test(auth): add integration tests for password reset
```

**Why mandatory:** Enables automated changelog generation, semantic versioning (fix → PATCH, feat → MINOR, BREAKING CHANGE → MAJOR), and CI triggers based on commit type.

### Enforce with Tooling

```bash
pnpm add -D @commitlint/cli @commitlint/config-conventional husky lint-staged
npx husky init
echo 'npx --no -- commitlint --edit "${1}"' > .husky/commit-msg
```

### Why PRs Matter Solo

1. **CI trigger point** — tests, linting, security scans run automatically
2. **Self-review** — reviewing your own diff catches mistakes
3. **Audit trail** — invaluable for debugging regressions months later
4. **AI review** — Claude Code as automated PR reviewer via GitHub Actions

### Branch Protection on `main`

Enable in GitHub repo settings:

- Require pull requests before merging
- Require status checks to pass (CI pipeline)
- Require linear history (forces squash merge)
- **Check "Include administrators"** — without this, rules don't apply to you

---

## Part 6: Automated Testing

### The Testing Trophy (Not the Pyramid)

Kent C. Dodds' Testing Trophy replaces the traditional pyramid for modern web apps. Priority order:

1. **Static analysis** — TypeScript strict + ESLint + Prettier (catches the largest class of errors at zero ongoing cost)
2. **Integration tests** — Core business logic and API routes (best confidence-to-effort ratio)
3. **Unit tests** — Complex pure functions, algorithms, data transformations
4. **E2E tests** — 3-5 critical user journeys (login, main workflow, payment)

### Framework Choices

| Tool                | Layer              | Why                                             |
| ------------------- | ------------------ | ----------------------------------------------- |
| **Vitest**          | Unit + integration | Native TS, 10-20x faster than Jest, zero config |
| **Playwright**      | E2E                | Cross-browser, free parallelization, codegen    |
| **Testing Library** | Component          | Behavior-focused React component testing        |

### Coverage Targets

Aim for **70-80%** on core business logic. Google considers 60% acceptable, 75% commendable. Set CI threshold at 70%. Use Codecov's "patch" check at 100% to ensure all new code is tested.

### Pre-Commit Hooks

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix --max-warnings=0", "prettier --write"],
    "*.{json,css,md,yml}": ["prettier --write"]
  }
}
```

```bash
# .husky/pre-commit
npx lint-staged

# .husky/pre-push
npx tsc --noEmit && npx vitest run
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --max-warnings=0",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "db:migrate": "drizzle-kit migrate",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio"
  }
}
```

---

## Part 7: CI/CD Pipeline — GitHub Actions

### The Pipeline

Stages execute in cost order — cheapest checks first:

**lint → type-check → test → build → security scan → (deploy in Phase 2)**

```yaml
# .github/workflows/ci.yml
name: CI Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      # Fast checks first
      - name: Lint
        run: pnpm lint

      - name: Type Check
        run: pnpm typecheck

      # Tests (with Postgres service)
      - name: Unit & Integration Tests
        run: pnpm test:coverage
        env:
          DATABASE_URL: postgresql://test:testpass@localhost:5432/testdb

      # Build verification
      - name: Build
        run: pnpm build

      # Security: dependency audit
      - name: Dependency Audit
        run: pnpm audit --audit-level=moderate

  # Docker build verification
  docker:
    runs-on: ubuntu-latest
    needs: quality
    steps:
      - uses: actions/checkout@v4

      - name: Build Docker Image
        run: docker build -t myapp:test .

      - name: Test Docker Image
        run: |
          docker run -d --name test-app -p 3000:3000 \
            -e DATABASE_URL="postgresql://fake:fake@localhost/fake" \
            myapp:test
          sleep 5
          docker logs test-app

  # E2E tests (run on PRs only to save minutes)
  e2e:
    runs-on: ubuntu-latest
    needs: quality
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - name: Install Playwright
        run: pnpm exec playwright install --with-deps chromium

      - name: Run E2E Tests
        run: pnpm test:e2e
        env:
          DATABASE_URL: postgresql://test:testpass@localhost:5432/testdb
```

### Claude Code as Automated PR Reviewer

```yaml
# .github/workflows/claude-review.yml
name: Claude Code Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review this PR for:
            1. Code quality and adherence to project conventions
            2. Security issues (injection, auth bypass, data exposure)
            3. Missing tests for new functionality
            4. Type safety concerns
            Be specific. Reference line numbers.
```

---

## Part 8: Security Scanning

### Day-One Setup (30 minutes, $0)

1. **Enable Dependabot** — `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
```

2. **Enable GitHub CodeQL** — repo Settings → Code Security → Enable default setup (detects XSS, SQL injection, path traversal, prototype pollution, SSRF)

3. **Enable GitHub Secret Scanning** — repo Settings → Code Security (scans for 200+ token patterns)

4. **Install Socket.dev GitHub App** — 2-minute setup, behavioral analysis of dependencies (caught patterns Dependabot missed in the Sept 2025 npm supply chain attack)

5. **Add `eslint-plugin-security`** to ESLint config

### Week-One Additions

**Gitleaks** — prevents accidental secret commits:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.16.1
    hooks:
      - id: gitleaks
```

**Trivy** in CI for filesystem/Docker scanning:

```yaml
# Add to CI pipeline
- name: Trivy Security Scan
  uses: aquasecurity/trivy-action@master
  with:
    scan-type: "fs"
    scan-ref: "."
    format: "sarif"
    output: "trivy-results.sarif"
    severity: "HIGH,CRITICAL"

- name: Upload Trivy Results
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: "trivy-results.sarif"
```

---

## Part 9: Phase 2 — Hosting Options

Hosting is deliberately Phase 2. Get your SDLC running locally first. When ready, you have three paths:

### Option A: Coolify + Hetzner (Self-Hosted PaaS) — Recommended for Control + Cost

**What Coolify is:** An open-source, self-hostable PaaS alternative to Vercel/Heroku/Netlify. Install it on any server (Hetzner VPS, Raspberry Pi, bare metal) and get: git-push deploys, automatic SSL via Let's Encrypt, preview deployments per PR, one-click databases, Docker-based builds, and a clean web dashboard.

**Is Coolify OpenAPI compatible?** Yes. Coolify ships with a full OpenAPI 3.1.0 specification (`openapi.yaml` in the repo). The API covers applications, databases, servers, deployments, and teams. You can automate deployments, manage resources, and integrate with external tools via the REST API using bearer token auth. The API docs are served via VitePress OpenAPI at `your-instance/docs/api-reference`.

**Coolify + Hetzner is the proven combo.** Coolify's own docs recommend Hetzner as the default VPS provider. The workflow: buy a €4.50/month Hetzner VPS (2 vCPU, 4GB RAM), install Coolify with one curl command, connect your GitHub repo, and you have Vercel-like DX on your own server. One developer reported running Next.js + Postgres + Meilisearch + Plausible Analytics all on a single €15/month Hetzner VPS — replacing $300/month in cloud bills.

**Setup flow:**

```
1. Create Hetzner Cloud account → spin up Ubuntu 24 VPS (CX22: €4.51/mo)
2. SSH into server
3. curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
4. Access Coolify dashboard at http://your-ip:8000
5. Connect GitHub repo
6. Add PostgreSQL as a one-click service
7. Configure environment variables
8. Push to main → auto-deploy
```

**What you get:**

- Git-based auto-deploy on push
- Preview deployments per PR
- One-click PostgreSQL, Redis, and 280+ services
- Automatic SSL certificates
- Database backups to S3-compatible storage
- API for CI/CD integration
- No vendor lock-in — all configs stored on your server

**Cost:** ~€4.50-15/month total (VPS only, Coolify is free forever, no feature paywalls)

### Option B: Cloudflare Workers via OpenNext (Edge-First)

Deploy Next.js to Cloudflare's edge network using the OpenNext adapter. This is not Cloudflare Pages (which is limited) — it's Cloudflare Workers with full SSR support.

**Key facts:**

- The old `@cloudflare/next-on-pages` package is **deprecated**. Use `@opennextjs/cloudflare` instead.
- Supports App Router, RSC, Server Actions, ISR, API routes
- Uses the Node.js runtime (not Edge runtime)
- Next.js 14, 15, and 16 supported
- Federal government sites (techforce.gov, safedc.gov) run this exact stack
- **$5/month** Workers Paid plan covers multiple production sites

**Setup:**

```bash
pnpm add -D @opennextjs/cloudflare wrangler

# Add to package.json scripts
"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview"
"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
```

**Tradeoffs vs Coolify+Hetzner:**

- Pro: Global edge deployment, massive CDN, DDoS protection built in
- Pro: No server management at all
- Con: Some Node.js APIs unavailable in Workers runtime
- Con: ISR works differently (stale-while-revalidate patterns)
- Con: 10 MiB Worker size limit on paid plan
- Con: No self-hosted database — need external Neon/PlanetScale

### Option C: Hetzner + Docker (No Coolify)

If you want maximum control without a PaaS layer, deploy your Docker container directly to Hetzner with a reverse proxy:

```
Hetzner VPS → Docker Compose → Traefik (reverse proxy + SSL) → Your containers
```

More work to set up, but no abstraction layer between you and the infrastructure.

### Hosting Decision Matrix

| Factor              | Coolify + Hetzner             | Cloudflare Workers                | Hetzner + Docker    |
| ------------------- | ----------------------------- | --------------------------------- | ------------------- |
| **Cost**            | €4.50-15/mo                   | $5/mo                             | €4.50-15/mo         |
| **Control**         | High                          | Low                               | Maximum             |
| **Complexity**      | Low (Coolify handles it)      | Low (managed)                     | High                |
| **Database**        | Self-hosted (free)            | External (Neon $0-25/mo)          | Self-hosted (free)  |
| **Global edge**     | No (single region)            | Yes (300+ PoPs)                   | No                  |
| **Preview deploys** | Yes                           | Yes                               | Manual              |
| **Vendor lock-in**  | None                          | Moderate (Workers runtime)        | None                |
| **Best for**        | Full-stack apps, cost control | Content-heavy sites, global reach | Complex infra needs |

### Cloudflare as CDN Layer (Works with Any Option)

Regardless of hosting choice, put Cloudflare in front as a CDN/proxy (free tier):

- DNS management
- DDoS protection
- Static asset caching
- SSL termination
- Web Application Firewall (WAF)

---

## Part 10: The Complete Pipeline (Commit to Production)

```
Developer writes code (VS Code + Claude Code)
        ↓
Spec Kit: /specify → /plan → /tasks → /implement (for new features)
        ↓
Pre-commit hook: ESLint fix + Prettier format (Husky + lint-staged)
        ↓
Commit with conventional message: feat(auth): add password reset
        ↓
Pre-push hook: TypeScript type-check + Vitest test suite
        ↓
Push feature branch → Open PR
        ↓
GitHub Actions CI triggers:
  ├── Lint check
  ├── Type check
  ├── Unit + integration tests (with Postgres service)
  ├── Docker build verification
  ├── CodeQL SAST scan
  ├── Dependency audit
  ├── Trivy filesystem scan
  └── Claude Code automated PR review
        ↓
Self-review diff in GitHub UI
        ↓
Squash-merge to main → Delete feature branch
        ↓
[Phase 2] Auto-deploy:
  ├── Coolify: detects push, builds Docker, deploys
  ├── Cloudflare: opennextjs-cloudflare build + deploy
  └── Direct Docker: pull image, docker compose up
        ↓
If issues → rollback (Coolify one-click / Cloudflare instant / git revert)
```

---

## Part 11: Implementation Roadmap

### Week 1 — Foundation

1. Scaffold Next.js + TypeScript + Tailwind + shadcn/ui
2. Initialize git repo, push to GitHub
3. Set up Docker Compose with local Postgres
4. Configure Drizzle ORM + initial schema
5. Set up Better Auth
6. Configure ESLint + Prettier + tsconfig strict
7. Install Husky + lint-staged + commitlint
8. Create CLAUDE.md with project conventions
9. Set branch protection on `main`
10. Enable Dependabot + CodeQL + GitHub secret scanning

### Week 2 — Testing & CI

1. Set up Vitest with integration tests for core routes
2. Add pre-commit and pre-push hooks
3. Create GitHub Actions CI pipeline (lint → test → build)
4. Install Socket.dev and Gitleaks
5. Add `eslint-plugin-security`
6. Set up Claude Code GitHub Action for PR review
7. Create production Dockerfile + test it locally

### Week 3 — Spec Kit & Polish

1. Install GitHub Spec Kit (`specify init . --ai claude`)
2. Create project constitution
3. Add Playwright E2E tests for 3-5 critical flows
4. Configure coverage thresholds at 70%
5. Add Trivy to CI pipeline
6. Set up Renovate for automated dependency updates
7. Practice the full cycle: spec → implement → test → PR → merge

### Week 4+ — Phase 2: Hosting (When Ready)

1. Choose hosting path (Coolify+Hetzner / Cloudflare / Direct Docker)
2. Set up production environment
3. Configure auto-deploy from `main`
4. Set up database backups
5. Add Cloudflare CDN layer
6. Configure monitoring and alerting

### Free Tier Budget

| Service                            | What You Get Free                                                        |
| ---------------------------------- | ------------------------------------------------------------------------ |
| **GitHub**                         | Unlimited repos, 2,000 CI min/month, Dependabot, CodeQL, secret scanning |
| **Docker Desktop**                 | Free for personal/small business                                         |
| **Better Auth + Drizzle + shadcn** | Free forever (MIT open-source)                                           |
| **Socket.dev**                     | Free for individual devs                                                 |
| **Gitleaks + Trivy**               | Free forever (open-source)                                               |
| **Cloudflare** (CDN/DNS)           | Free tier: unlimited bandwidth, DDoS protection                          |
| **Coolify**                        | Free forever (open-source, no paywalls)                                  |
| **Hetzner**                        | Starting €4.51/month (when you're ready)                                 |

---

## Appendix: Key Decision Log

**Why Better Auth over Auth.js?** Auth.js team joined Better Auth in September 2025. Auth.js still gets security patches, but Better Auth is the forward path. TypeScript-first, more features, actively maintained.

**Why Vitest over Jest?** Native TypeScript support, 10-20x faster watch mode via Vite, 95% Jest-compatible API, zero config.

**Why Playwright over Cypress?** Surpassed Cypress in npm downloads June 2024, cross-browser including Safari, free parallelization, built-in codegen.

**Why Drizzle over Prisma?** SQL-first approach (you write SQL, get type safety), no codegen step, 7.4kb bundle vs Prisma's heavier runtime, better for serverless.

**Why Coolify over Vercel?** Self-hosted = no surprise bills, no vendor lock-in, self-hosted database included. Coolify gives you Vercel DX on your own €5/month server. Vercel is great for prototyping on free tier, but costs climb fast with traffic.

**Why trunk-based over GitFlow?** DORA research: highest-performing teams use three or fewer active branches. GitFlow's creator now recommends simpler workflows. For solo dev, GitFlow is pure overhead.

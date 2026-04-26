---
name: security
description: >
  Deep security review of recent code changes. Performs threat modeling,
  OWASP Top 10 checks, auth/authz validation, input sanitization review,
  and generates actionable fix suggestions. Use before PRs, after completing
  features, or when the user says "security review", "check security", or
  runs /security.
command: /security
argument-hint: "[file paths or git ref, default: unstaged changes]"
allowed-tools: Read, Glob, Grep, Write, Edit, MultiEdit, Bash, TodoWrite
---

# Security Review: Deep Scan

Perform a thorough security review of recent code changes. Follow every
phase in order.

Scope: $ARGUMENTS (if empty, review unstaged changes via `git diff`)

---

## PHASE 1 — SCOPE

1. Determine what to review:
   - If `$ARGUMENTS` specifies files or a git ref, use that.
   - Otherwise, run `git diff --name-only` to get unstaged changes.
   - If no unstaged changes, run `git diff HEAD~1 --name-only` for the last commit.
2. List all files to review. Skip generated files (`*/generated/*`, `*/__generated__/*`).
3. Read each file to understand what was added or changed.

---

## PHASE 2 — THREAT MODEL

Classify the changes into threat categories:

| Change type                       | Threat categories to check                               |
| --------------------------------- | -------------------------------------------------------- |
| API endpoint / controller         | Auth bypass, IDOR, mass assignment, rate limiting        |
| User input handling (forms, DTOs) | Injection (SQL, XSS, command), validation bypass         |
| Authentication / session code     | Credential stuffing, session fixation, token leakage     |
| File upload / download            | Path traversal, unrestricted upload, SSRF                |
| Database queries                  | SQL injection, data exposure, missing tenant scoping     |
| External API calls                | SSRF, secret leakage, response injection                 |
| Frontend rendering                | XSS (DOM-based), open redirect, sensitive data in client |
| Configuration / env vars          | Hardcoded secrets, insecure defaults, missing validation |

Output a brief threat model: what the code does, what could go wrong.

---

## PHASE 3 — REVIEW

Check each file against applicable categories from Phase 2:

### OWASP Top 10 Checks

1. **Broken Access Control** — Missing auth guards, IDOR, missing tenant scoping
2. **Cryptographic Failures** — Plaintext secrets, weak hashing, missing encryption
3. **Injection** — Raw SQL, unsafe DOM manipulation, dynamic code execution, unsanitized templates, command injection
4. **Insecure Design** — Missing rate limiting, predictable IDs, missing CSRF protection
5. **Security Misconfiguration** — Debug mode in production, permissive CORS, verbose errors
6. **Vulnerable Components** — Known CVEs in dependencies (run `npm audit` if relevant)
7. **Auth Failures** — Weak password rules, session not invalidated on logout
8. **Data Integrity** — Missing input validation, unsigned data, tamperable client-side state
9. **Logging Failures** — Sensitive data in logs, missing audit trail for destructive operations
10. **SSRF** — User-controlled URLs passed to server-side fetch/request

### Platform Security Checks

If `.claude/skills/security/PROJECT_OVERRIDES.md` exists, **Read it now** and
use its `## Platform Security Checks` section instead of (or in addition to)
the OWASP checks above.

---

## PHASE 4 — REPORT

Output findings in this format:

```
## Security Review Report

### Summary
- Files reviewed: [count]
- Threat categories: [list]
- Findings: [critical] critical, [high] high, [medium] medium, [low] low

### Findings

#### [CRITICAL/HIGH/MEDIUM/LOW] — Title
- **File**: path/to/file.ts:LINE
- **Category**: OWASP category
- **Issue**: What's wrong
- **Impact**: What could happen if exploited
- **Fix**: Specific code change to resolve

### No Issues Found
(If clean, state this explicitly with what was checked)
```

### PAUSE — Show findings

If any CRITICAL or HIGH findings exist, show the report and ask:

> "Found [N] security issues. Want me to fix them now?"

**Wait for user response before proceeding to Phase 5.**

If only MEDIUM/LOW or no findings, proceed automatically.

---

## PHASE 5 — FIX

For each CRITICAL and HIGH finding (and MEDIUM if user requested):

1. Apply the fix described in the report.
2. Run tests after each fix.
3. If a fix breaks tests, revert and try a different approach.
4. After all fixes applied, run full validation using `TYPECHECK_CMD` from
   `.claude/framework.json` (or the command in CLAUDE.md if framework.json absent).

Output a summary of fixes applied.

# Plan: `scripts/capture-session.ts` — automate the 999.md capture runbook

## Context

The GraphQL migration is code-complete and 70/70 tests pass, but [src/graphql.ts](../../src/graphql.ts) holds **best-effort-reconstructed** `SEARCH_ADS_QUERY` and `GET_ADVERT_QUERY` strings. They mirror the JSON shape in the saved fixtures but were never captured from a real browser, so the live smoke run (`RUN_ONCE=1 pnpm dev`) is blocked: 999.md will likely reject them with type-mismatch / "Unknown argument" errors.

Today's manual unblock is the runbook in [docs/capture-session.md](../../docs/capture-session.md). It is mechanical (~15 min of clicking + copy/paste) and recurs every few months whenever 999.md changes its schema or anti-bot stance. The runbook itself flags this in §8: "could be a Playwright-MCP script: `scripts/capture-session.ts`".

This plan builds that script. Goal: replace the manual runbook with a single command that drives a headed Firefox browser through the same navigation, intercepts the two GraphQL POSTs, and updates queries, fixtures, headers, and cookies in one shot.

User decisions (this session):

- **Full capture**: queries + fixtures + headers + cookies (matches runbook §6 end-to-end).
- **Headed by default**: `--headless` flag overrides. First capture often needs a human-in-the-loop for Cloudflare challenges; refreshes are infrequent so a visible browser is fine.

The script is a project-local dev tool — not part of the runtime crawler. It runs ad-hoc when the live run starts failing or fixtures get stale.

## Approach

A standalone TypeScript script under `scripts/capture-session.ts`, runnable via `pnpm tsx scripts/capture-session.ts [--headless]`. Uses the `playwright` npm package directly (Firefox launcher) — **not** Playwright MCP, since MCP is an interactive Claude tool, not a runtime library a script can drive.

Flow:

1. Launch Firefox (headed unless `--headless`), fresh context (no persisted cookies), realistic viewport.
2. Navigate `https://999.md/` → wait for idle. (Lets Cloudflare set anti-bot cookies.)
3. Navigate `https://999.md/ro/list/real-estate/houses-and-yards` → wait for the listings grid.
4. Capture the first POST to `https://999.md/graphql` whose request body has `operationName: "SearchAds"`. Stash request + response.
5. Click the first listing card → wait for the detail page to render.
6. Capture the first POST to `https://999.md/graphql` whose request body has `operationName: "GetAdvert"`. Stash request + response.
7. Close the browser. **All-or-nothing**: if either capture is missing, abort with a non-zero exit and no file writes.
8. Diff captured `variables` shapes against [`buildSearchVariables(0)`](../../src/graphql.ts#L53) and [`buildAdvertVariables(id)`](../../src/graphql.ts#L63) — log discrepancies but do **not** auto-edit the builders (those are human-curated against `FILTER` in [config.ts](../../src/config.ts)).
9. Write artifacts (next section). Print a summary table of what changed.

## Files to add / modify

### New

- **`scripts/capture-session.ts`** — the script. ~250 lines. Uses `playwright`, `node:fs/promises`, `node:path`, `node:url` only. ESM with `.js` import extensions per project convention.

### Modified

- **[`package.json`](../../package.json)** — add `playwright` to `devDependencies` (Firefox driver bundled). Add a script: `"capture-session": "tsx scripts/capture-session.ts"`. Keep all other scripts as-is.
- **[`src/graphql.ts`](../../src/graphql.ts)** — overwrite the bodies of `SEARCH_ADS_QUERY` and `GET_ADVERT_QUERY` template literals. **Do not touch** the `import`, the variable builders, or surrounding code. Flip the leading `// REPLACE-ME` comments to `// CAPTURED <ISO timestamp> by scripts/capture-session.ts` so future grep-for-REPLACE-ME doesn't get false positives.
- **[`src/__tests__/fixtures/search-ads-response.json`](../../src/__tests__/fixtures/search-ads-response.json)** — overwrite with captured JSON, trimmed to first 5 ads (matches existing fixture size; keeps tests fast and diffs reviewable).
- **[`src/__tests__/fixtures/advert-detail-response.json`](../../src/__tests__/fixtures/advert-detail-response.json)** — overwrite with captured JSON in full.
- **`docs/captured-headers.md`** *(new file, committed)* — table of every request header observed on both POSTs, annotated as `static` vs `per-request` (script heuristic: cookie/auth/CSRF/timestamp tokens → per-request; everything else → static). Human review still required before wiring.
- **`.env.local`** *(new, gitignored — `.env.*` is already in [.gitignore](../../.gitignore#L20))* — write `BOOTSTRAP_COOKIES="..."` with the full cookie string from the browser context. Replace existing line if present.
- **[`src/config.ts`](../../src/config.ts)** — update `POLITENESS.userAgent` if the captured UA differs from the current value. Print a diff to stdout before writing. **Do not** add `extraHeaders` here — wiring static headers into the runtime fetcher is a separate task (the runbook §6 lists it but it requires schema/code changes in [`fetch.ts`](../../src/fetch.ts) that aren't capture-script concerns).

## Replacement strategy details

[`src/graphql.ts`](../../src/graphql.ts) is small and stable. The two query constants follow this exact shape:

```ts
export const SEARCH_ADS_QUERY = `query SearchAds(...) {
  ...
}`;
```

Replace with a regex-anchored, non-greedy match between `` ` `` and `` `; ``, scoped to the line starting with `export const SEARCH_ADS_QUERY = \``. Sanity-check before writing:

- Captured string must start with `query SearchAds(` (resp. `query GetAdvert(`).
- Captured string must contain a balanced `{ ... }` body.
- After substitution, the resulting `src/graphql.ts` must still parse as valid TS — verify by spawning `pnpm typecheck` from inside the script and aborting if it fails (rolling back via a backup copy taken before the edit).

Prettier may want to reformat the captured query (long line, weird indentation). Run `pnpm prettier --write src/graphql.ts` at the end of the script — it's already a project dep.

## Diff & report (no auto-fix for shape drift)

After capture, the script computes:

| Captured | Compared to | Action |
|---|---|---|
| Request body `query` (SearchAds) | `SEARCH_ADS_QUERY` | overwrite |
| Request body `variables` (SearchAds) | `buildSearchVariables(0)` output | log-only diff |
| Request body `query` (GetAdvert) | `GET_ADVERT_QUERY` | overwrite |
| Request body `variables` (GetAdvert) | `buildAdvertVariables(<id>)` output | log-only diff |
| Response JSON (SearchAds) | `search-ads-response.json` | overwrite (trim ads to 5) |
| Response JSON (GetAdvert) | `advert-detail-response.json` | overwrite |
| `User-Agent` header | `POLITENESS.userAgent` | overwrite if drifted |
| All other request headers | (none) | dump to `docs/captured-headers.md` |
| Cookies on context | (none) | write `.env.local` |

Variable-shape drift gets a clear stderr message pointing the human at [src/graphql.ts](../../src/graphql.ts) builders or [src/config.ts](../../src/config.ts) `FILTER.searchInput`. Auto-editing those is out of scope — they're tied to verified filter IDs and changing them blindly risks breaking the search semantics that took real exploration to nail down (see the URL-param-vs-GraphQL ID-space warning in [config.ts:8-10](../../src/config.ts#L8-L10)).

## Verification

End-to-end test (run by hand after the script lands; not automatable in CI since it hits live 999.md):

1. `pnpm install` — picks up the new `playwright` devDep + Firefox driver.
2. `pnpm capture-session` — script launches Firefox, runs the flow, writes files.
3. `git diff` — review:
   - [src/graphql.ts](../../src/graphql.ts) bodies replaced, builders untouched.
   - Both fixtures updated, parser tests still pass.
   - `docs/captured-headers.md` populated.
   - `.env.local` has `BOOTSTRAP_COOKIES=`.
4. `pnpm test` — all 70 tests must still pass against the new fixtures. (Schema drift would surface here; if a parser test fails, the live schema changed and the parser needs updating — captured as expected behavior.)
5. `pnpm typecheck && pnpm lint && pnpm build` — green.
6. `RUN_ONCE=1 LOG_LEVEL=debug pnpm dev` — actual live smoke. Watch for: 200 on first SearchAds, ads array non-empty, at least one detail fetched. This is the original blocker; the script's job is to make this command succeed.

Unit-test coverage for the script itself is **not** in scope — the script's correctness is judged by whether the live smoke passes, and mocking Playwright + 999.md to cover it would cost more than re-running the capture.

## Out of scope (deliberate)

- Adding `extraHeaders` to `POLITENESS` and wiring per-request `Referer` in [`fetch.ts`](../../src/fetch.ts). The runbook §6 lists these — separate follow-up.
- Cookie auto-refresh in the runtime crawler (the runbook calls this out as a "separate implementation step"). Manual cookie capture every ~30 min is fine for first smoke runs.
- Updating builders in [src/graphql.ts](../../src/graphql.ts) when the captured `variables` shape drifts. Reported as a warning; human decides.
- Tests for the capture script. See "Verification" rationale.
- Running the script as part of `pnpm dev` or CI. It's a manual ad-hoc tool.

## Open considerations (flag during execution, don't pre-decide)

- **Cloudflare on first cold launch**: a fresh Playwright context may hit a JS challenge. With headed mode the human can solve it; the script just needs to wait long enough (default 30s, `--timeout` flag for override). Worth confirming behavior on first run.
- **Firefox driver disk size**: `playwright` brings ~120 MB of Firefox per platform. Acceptable for a dev-only tool, but worth noting in the PR description.
- **Listing click selector**: the listings grid markup may change. Use a robust selector — `a[href^="/ro/"]` filtered to the listings container, take the first match. If 999.md re-themes, this needs updating; that's the price of automating brittle UI flows.

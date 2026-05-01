# Capture-Session Runbook

> How to refresh the real-browser GraphQL queries, headers, and cookies that
> let our crawler look like a human browsing 999.md.
>
> Re-run this whenever:
> - A live request returns 400/401/403/429 unexpectedly (schema or anti-bot moved)
> - You see "Unknown argument" / "Cannot query field" GraphQL errors
> - The fixtures get stale (every few months, or after a 999.md UI change)

Time: ~15 minutes start to finish.

---

## 0. Prep

- Use **Firefox** (not Chrome) — our `User-Agent` claims Firefox, so the
  header set we capture must come from Firefox to stay internally consistent.
- Open a **fresh private window** so old session cookies don't pollute the capture.
- Open **DevTools → Network tab** *before* you navigate. Check "Preserve log".
- Filter the Network panel to **XHR/Fetch** only.

---

## 1. Bootstrap the session (cookies + base headers)

Browse like a human for ~30 seconds:

1. Navigate to `https://999.md/` (homepage).
2. Click **Imobiliare** → **Case, vile**.
3. Click **Chișinău** in the region filter.
4. Wait for the listings grid to render.
5. Scroll once.

This gives 999.md / Cloudflare time to set anti-bot cookies (`cf_clearance`,
`__cf_bm`, etc.) and exercises the same request order a real user would.

### What to capture from this phase

- **Application tab → Cookies → https://999.md** — copy ALL cookie name/value
  pairs into a single `Cookie:` header string, e.g.
  `cf_clearance=abc...; __cf_bm=xyz...; PHPSESSID=...`.
- Save into a new file `.env.local` (gitignored) as
  `BOOTSTRAP_COOKIES="cf_clearance=...; ..."` — never commit cookies.

Cookies expire (anti-bot ones in ~30 min, others longer). When they do, the
crawler should re-bootstrap by fetching `/` itself. That's a separate
implementation step; for first manual smoke runs, a freshly-captured cookie
string is enough.

---

## 2. Capture the SearchAds GraphQL request

Still in that browser session:

1. In Network panel, find the POST to `https://999.md/graphql` whose payload
   `operationName` is `SearchAds`. (If you see several, pick one fired *after*
   the listings grid finished rendering — the bootstrap does several queries.)
2. Right-click → **Copy → Copy as cURL**. Paste into a scratch file.

### Extract from the cURL

a) **The `query` string** (inside the `--data-raw` JSON):
   - Replace the body of `SEARCH_ADS_QUERY` in `src/graphql.ts` with this
     exact string (preserve whitespace and field order).

b) **The `variables` shape** (also inside `--data-raw`):
   - Compare against what `buildSearchVariables(0)` in `src/graphql.ts` produces.
   - If shape differs (extra fields, nested wrapper, etc.) update the builder.
   - Verify the `searchInput.filters` IDs match `FILTER.searchInput` in
     `src/config.ts`. Note any drift.

c) **All the `-H` headers**:
   - Identify the ones we don't already send. Likely candidates:
     - `Origin: https://999.md`
     - `Referer: https://999.md/ro/list/real-estate/houses-and-yards`
     - `Sec-Fetch-Site: same-origin`
     - `Sec-Fetch-Mode: cors`
     - `Sec-Fetch-Dest: empty`
     - `X-Requested-With` (if present — sometimes `XMLHttpRequest`)
     - Any custom `X-*` headers the site sets (rare, but check)
   - List every header with name + value into a new file
     `docs/captured-headers.md` (gitignored if values are sensitive — review
     before committing). Mark which are static and which look per-request
     (e.g. CSRF token).

d) **The `User-Agent`** the browser actually sent:
   - Compare against `POLITENESS.userAgent` in `src/config.ts`. Update ours
     to match the captured Firefox version exactly. Mismatched UA + UA-CH
     headers is a strong bot signal.

---

## 3. Capture the GetAdvert GraphQL request

1. From the listings grid, click into any listing.
2. In Network panel, find the POST to `https://999.md/graphql` with
   `operationName: GetAdvert`.
3. Right-click → **Copy → Copy as cURL**.

### Extract from the cURL

a) **The `query` string** → replace `GET_ADVERT_QUERY` body in `src/graphql.ts`.
b) **The `variables` shape** → compare against `buildAdvertVariables(id)`.
   Likely `{ input: { id: "<id>" } }` — confirm and adjust if wrapped differently.
c) **Headers** — same set as SearchAds; the `Referer` will now be the listing
   URL itself (`https://999.md/ro/<id>`). Note that the per-request Referer
   matters: SearchAds Referer = listings page, GetAdvert Referer = previous
   listing or listings page. We should mirror this.

---

## 4. Refresh the test fixtures

The fixtures in `src/__tests__/fixtures/` were captured 2026-04-26. If the
schema changed, the parsers will break against fresh data even after the
queries are fixed. To refresh:

1. From the GetAdvert response panel → right-click in the **Response** tab →
   **Copy Response**.
2. Paste into `src/__tests__/fixtures/advert-detail-response.json` and
   pretty-print (`pnpm prettier --write` after un-ignoring the file
   temporarily, or `python3 -m json.tool`).
3. Same for SearchAds → `src/__tests__/fixtures/search-ads-response.json`
   (you only need ~5 ads — trim the array if larger).
4. Run `pnpm test` — any parser test that fails reveals a real schema change
   that needs a code update.

---

## 5. Behavioral details to capture (often missed)

These are subtle but matter for not-looking-like-a-bot:

- **Request order**: when the page loads, browsers fire requests in a
  deterministic order (HTML → JS → CSS → fonts → first XHR → ...). Copy
  the *order* of requests for the listings page from Network panel.
  Our bootstrap should mimic at least the HTML+first-XHR ordering.
- **Sub-resource fetches**: a real browser also pulls images, fonts, JS
  bundles. We don't need to fetch all of them, but fetching `/` HTML on
  bootstrap (and discarding the body) is cheap and convincing.
- **Inter-click pacing**: time the gaps between your manual clicks in the
  Network "Waterfall" view. Real-user gaps cluster around 2–5s with
  occasional 30s+ pauses. Feed this distribution into our jitter logic.

---

## 6. Where each captured artifact lands

| Captured | Destination | Commit? |
|---|---|---|
| SearchAds `query` string | `src/graphql.ts` → `SEARCH_ADS_QUERY` | yes |
| GetAdvert `query` string | `src/graphql.ts` → `GET_ADVERT_QUERY` | yes |
| `variables` shape adjustments | `src/graphql.ts` builders | yes |
| Filter ID drift | `src/config.ts` → `FILTER.searchInput` | yes |
| Static request headers | `src/config.ts` → `POLITENESS` (extend with `extraHeaders`) | yes |
| Updated User-Agent | `src/config.ts` → `POLITENESS.userAgent` | yes |
| Referer mapping rules | `src/fetch.ts` (per-call header) or new helper | yes |
| Cookies | `.env.local` → `BOOTSTRAP_COOKIES` | **NO** (gitignored) |
| Fresh JSON responses | `src/__tests__/fixtures/*.json` | yes |
| Header capture log | `docs/captured-headers.md` | review before committing |

---

## 7. Smoke test after capture

```bash
pnpm test                                  # parsers/fetcher still green
RUN_ONCE=1 LOG_LEVEL=debug pnpm dev        # one live tick against 999.md
```

Watch for:
- First request returns 200 (cookies + headers accepted).
- SearchAds returns `data.searchAds.ads` (queries match schema).
- 1+ details fetched without 4xx.
- `data/property.db` row count grows.

If any 4xx: re-check Cookie freshness first (most common cause), then
header drift, then query/variables drift.

---

## 8. Future automation

This whole runbook is mechanical and could be a Playwright-MCP script:
`scripts/capture-session.ts` would launch Firefox, navigate the same path,
intercept the two GraphQL POSTs, write the queries + fixtures + a
`captured-headers.json` to disk. Build it next time this runbook gets used
manually — cost amortizes after 2 captures.

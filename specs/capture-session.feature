Feature: Capture-session script for refreshing 999.md GraphQL artefacts
  In order to keep src/graphql.ts queries, fixtures, headers, and cookies
  aligned with whatever 999.md currently serves
  As a developer running ad-hoc maintenance
  I want a Playwright-driven script that drives Firefox through the same
  navigation a human would, intercepts SearchAds + GetAdvert POSTs, and
  writes the artefacts back to disk in one shot — with pure helpers split
  out so the wiring logic is unit-testable without a live browser

  # ─────────────────────────────────────────────────────────────────────
  # CLI argument parsing
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Defaults to headed browser with 30s challenge timeout
    Given the script is invoked with no arguments
    When parseArgs([]) runs
    Then the result is { headless: false, timeoutMs: 30000 }

  Scenario: --headless flag flips browser to headless mode
    Given the script is invoked with --headless
    When parseArgs(['--headless']) runs
    Then the result.headless is true

  Scenario: --timeout overrides the default challenge wait
    When parseArgs(['--timeout', '60000']) runs
    Then the result.timeoutMs is 60000

  Scenario: Unknown flag aborts with a helpful error
    When parseArgs(['--nope']) runs
    Then it throws an Error mentioning the unknown flag

  # ─────────────────────────────────────────────────────────────────────
  # Header classification heuristic
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Cookie header is per-request
    When classifyHeader('cookie') runs
    Then the result is 'per-request'

  Scenario: Authorization header is per-request
    When classifyHeader('Authorization') runs
    Then the result is 'per-request'

  Scenario: CSRF token header is per-request
    When classifyHeader('x-csrf-token') runs
    Then the result is 'per-request'

  Scenario: Plain Accept-Language is static
    When classifyHeader('accept-language') runs
    Then the result is 'static'

  Scenario: Sec-Fetch-Site is static
    When classifyHeader('sec-fetch-site') runs
    Then the result is 'static'

  # ─────────────────────────────────────────────────────────────────────
  # Query body replacement in src/graphql.ts
  # ─────────────────────────────────────────────────────────────────────

  Scenario: Replaces SEARCH_ADS_QUERY body and updates the REPLACE-ME marker
    Given a graphql.ts file with `export const SEARCH_ADS_QUERY = \`old\`;`
    And a captured query starting with "query SearchAds("
    When replaceQueryBody(source, 'SEARCH_ADS_QUERY', captured, '2026-05-01T12:00:00Z') runs
    Then the new source contains the captured query inside the template literal
    And the leading `// REPLACE-ME` comment becomes `// CAPTURED 2026-05-01T12:00:00Z by scripts/capture-session.ts`
    And the GET_ADVERT_QUERY block is unchanged

  Scenario: Replaces GET_ADVERT_QUERY body without touching SEARCH_ADS_QUERY
    Given a graphql.ts file with both query constants
    When replaceQueryBody(source, 'GET_ADVERT_QUERY', captured, ts) runs
    Then SEARCH_ADS_QUERY body is untouched
    And GET_ADVERT_QUERY body is the captured string

  Scenario: Refuses to replace when the captured string is the wrong operation
    Given a captured string that does not start with "query SearchAds("
    When replaceQueryBody(source, 'SEARCH_ADS_QUERY', captured, ts) runs
    Then it throws an Error mentioning operation mismatch

  Scenario: Refuses to replace when the export cannot be located
    Given a source file that does not declare SEARCH_ADS_QUERY
    When replaceQueryBody(source, 'SEARCH_ADS_QUERY', validQuery, ts) runs
    Then it throws an Error mentioning the missing export

  # ─────────────────────────────────────────────────────────────────────
  # Fixture trimming
  # ─────────────────────────────────────────────────────────────────────

  Scenario: trimSearchAdsResponse keeps only the first N ads but preserves count
    Given a SearchAds JSON with 78 ads and count 3302
    When trimSearchAdsResponse(json, 5) runs
    Then the result has 5 ads
    And the result.data.searchAds.count is still 3302

  # ─────────────────────────────────────────────────────────────────────
  # Variable shape diff
  # ─────────────────────────────────────────────────────────────────────

  Scenario: diffVariables reports no drift when shapes match
    Given captured = { input: { subCategoryId: 1406, limit: 78, skip: 0 } }
    And expected = { input: { subCategoryId: 1406, limit: 78, skip: 0 } }
    When diffVariables(captured, expected) runs
    Then the result is { ok: true, messages: [] }

  Scenario: diffVariables flags missing fields the builder does not produce
    Given captured has an extra top-level field "version: 2"
    When diffVariables runs
    Then result.ok is false
    And result.messages contains a string mentioning "version"

  Scenario: diffVariables flags fields the builder produces that capture lacks
    Given expected has "limit: 78" but captured has no "limit"
    When diffVariables runs
    Then result.ok is false
    And result.messages mentions "limit"

  # ─────────────────────────────────────────────────────────────────────
  # Cookie env formatting
  # ─────────────────────────────────────────────────────────────────────

  Scenario: formatCookieEnv joins cookie pairs and quotes the value
    Given cookies = [{ name: 'cf_clearance', value: 'abc' }, { name: '__cf_bm', value: 'xyz' }]
    When formatCookieEnv(cookies) runs
    Then the result is `BOOTSTRAP_COOKIES="cf_clearance=abc; __cf_bm=xyz"`

  Scenario: formatCookieEnv escapes embedded double quotes
    Given a cookie value containing a literal "
    When formatCookieEnv runs
    Then the embedded quote is backslash-escaped in the output

  # ─────────────────────────────────────────────────────────────────────
  # Header table rendering
  # ─────────────────────────────────────────────────────────────────────

  Scenario: headersMarkdownTable groups headers by classification with one row per header
    Given a header map { cookie: '...', accept: '*/*', 'sec-fetch-site': 'same-origin' }
    When headersMarkdownTable(headers) runs
    Then the output is a markdown table with columns Name, Value, Class
    And the cookie row's Class column is "per-request"
    And the accept row's Class column is "static"

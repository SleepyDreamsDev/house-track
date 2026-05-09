Feature: Interactive sweep filter (generic UI, source-mapped)
  As an operator of house-track
  I want to edit the search filter through the UI without redeploying
  And I want the same generic fields to map to whichever source is active
  So that adding a second source later (e.g., Lara) requires only a new mapping, not a UI change

  Background:
    Given the only registered source is "999md"
    And no FilterPreset has been persisted yet so the resolver falls back to the config constant

  # ── Generic schema ────────────────────────────────────────────────────────

  Scenario: GenericFilter accepts the default sale filter
    Given a generic filter with transactionType "sale", category "house", locality ["chisinau"], priceMax 250000, sqmMax 200
    When I parse it through genericFilterSchema
    Then validation succeeds

  Scenario: GenericFilter rejects priceMin greater than priceMax
    Given a generic filter with priceMin 300000 and priceMax 100000
    When I parse it through genericFilterSchema
    Then validation fails with a field-path "priceMin"

  Scenario: GenericFilter rejects sqmMin greater than sqmMax
    Given a generic filter with sqmMin 250 and sqmMax 100
    When I parse it through genericFilterSchema
    Then validation fails with a field-path "sqmMin"

  Scenario: GenericFilter rejects an empty locality list
    Given a generic filter with locality []
    When I parse it through genericFilterSchema
    Then validation fails with a field-path "locality"

  Scenario: GenericFilter rejects a negative price
    Given a generic filter with priceMax -1
    When I parse it through genericFilterSchema
    Then validation fails with a field-path "priceMax"

  # ── 999.md mapping parity ─────────────────────────────────────────────────

  Scenario: 999md adapter resolves the default generic filter to today's exact searchInput
    Given the default generic filter (sale, house, [chisinau], priceMax 250000, sqmMax 200)
    When I call the 999md source's resolve()
    Then the result.searchInput deep-equals FILTER.searchInput from src/config.ts
    And the result.postFilter deep-equals FILTER.postFilter

  Scenario: 999md adapter throws UnknownGenericFilterValueError on an unmapped locality
    Given a generic filter with locality ["atlantis"]
    When I call the 999md source's resolve()
    Then it throws UnknownGenericFilterValueError with field "locality" and value "atlantis"

  Scenario: 999md adapter derives postFilter from priceMax and sqmMax
    Given a generic filter with priceMax 180000 and sqmMax 150
    When I call the 999md source's resolve()
    Then the result.postFilter equals { maxPriceEur: 180000, maxAreaSqm: 150 }

  # ── Resolver (DB ↔ fallback) ──────────────────────────────────────────────

  Scenario: resolveActiveFilter falls back to the config constant when no setting exists
    Given Setting "filter.generic" has not been written
    When I call resolveActiveFilter()
    Then the result.searchInput deep-equals FILTER.searchInput
    And the result.sourceSlug equals "999md"

  Scenario: resolveActiveFilter reads the persisted generic filter and runs the active source's resolve()
    Given Setting "filter.generic" has been written with priceMax 180000
    When I call resolveActiveFilter()
    Then result.postFilter.maxPriceEur equals 180000
    And result.searchInput.subCategoryId equals 1406

  # ── HTTP API ──────────────────────────────────────────────────────────────

  Scenario: GET /api/filter returns the active generic filter, sources list, and resolved input
    Given the resolver is the default fallback
    When I GET /api/filter
    Then the response status is 200
    And the body has shape { generic, sources: [{slug, name, active}], resolved: { searchInput, postFilter } }
    And sources contains exactly one entry with slug "999md" and active true

  Scenario: PUT /api/filter persists a valid generic filter and returns the resolved view
    Given a valid generic filter with priceMax 180000
    When I PUT /api/filter with that body
    Then the response status is 200
    And a subsequent GET /api/filter returns the same generic
    And resolved.postFilter.maxPriceEur equals 180000

  Scenario: PUT /api/filter rejects priceMin > priceMax with a 400 carrying field path
    Given a generic filter with priceMin 300000 and priceMax 100000
    When I PUT /api/filter with that body
    Then the response status is 400
    And the response body includes details with at least one entry whose path is "priceMin"

  Scenario: PUT /api/filter rejects an unmapped locality with a 400 from the source adapter
    Given a generic filter with locality ["atlantis"]
    When I PUT /api/filter with that body
    Then the response status is 400
    And the error message identifies "locality" and "atlantis"

  # ── Sweep wiring ──────────────────────────────────────────────────────────

  Scenario: buildSearchVariables uses the resolved searchInput when one is supplied
    Given a resolved searchInput where subCategoryId is 9999 (test override)
    When I call buildSearchVariables(0, override)
    Then variables.input.subCategoryId equals 9999
    And variables.input.pagination has limit and skip

  Scenario: buildSearchVariables falls back to FILTER.searchInput when no override is supplied
    Given no override is passed
    When I call buildSearchVariables(2)
    Then variables.input.subCategoryId equals FILTER.searchInput.subCategoryId
    And variables.input.pagination.skip equals 2 * FILTER.pageSize

  # ── Source registry ───────────────────────────────────────────────────────

  Scenario: listSources returns at least the 999md adapter
    When I call listSources()
    Then the result includes an entry with slug "999md" and a resolve() function

  Scenario: getSource returns null for an unknown slug
    When I call getSource("lara")
    Then the result is null

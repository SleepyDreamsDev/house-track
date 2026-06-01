Feature: Multi-source abstraction & 999.md adapter
  In order to support multiple real estate data sources without code duplication
  As the house-track operator
  I want to plug in a new source adapter (resolve a generic filter into source-specific GraphQL inputs)
  And be confident the crawler and UI work correctly for every source

  Background:
    Given the source registry is initialized with at least source999md
    And the default generic filter is valid and resolves without throwing

  Scenario: Source registry lists all available adapters
    When I call listSources()
    Then the result includes at least one source with slug, name, and a resolve function
    And each source's resolve function is callable

  Scenario: Get source by slug returns the adapter or null
    When I call getSource("999md")
    Then I receive the 999md adapter (slug="999md", name="999.md")
    When I call getSource("nonexistent")
    Then I receive null

  Scenario: Active source slug is hardcoded as 999md
    Given ACTIVE_SOURCE_SLUG is set
    When the crawler starts
    Then it looks up the active source by slug
    And the active source is found (not null)

  Scenario: 999md adapter resolves house category to subCategoryId 1406
    Given a generic filter with category="house"
    When source999md.resolve(filter) is called
    Then the result has searchInput.subCategoryId = 1406

  Scenario: 999md adapter resolves apartment category to subCategoryId 1404
    Given a generic filter with category="apartment"
    When source999md.resolve(filter) is called
    Then the result has searchInput.subCategoryId = 1404

  Scenario: 999md adapter rejects unknown category (direct call, Zod bypassed)
    Given a generic filter with category="cottage" (not house or apartment), constructed directly without Zod
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError(field="category", value="cottage")
    And note: via /api/filters or resolveActiveFilter this is unreachable because genericFilterSchema (z.enum) rejects "cottage" with a Zod error first, never UnknownGenericFilterValueError

  Scenario: 999md adapter validates filterId exists in category taxonomy
    Given a generic filter with category="house"
    And a filter selection with filterId=999999 (not in filter-taxonomy.1406.json)
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError(field="filterId", value="999999")

  Scenario: 999md adapter validates featureId exists under the filterId
    Given a generic filter with category="house"
    And a filter selection with filterId=16 (exists), featureId=999999 (does not exist under 16)
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError(field="featureId", value="999999")

  Scenario: 999md adapter accepts valid options selection
    Given a generic filter with kind="options", filterId=1193, featureId=247, optionIds=[897]
    When source999md.resolve(filter) is called
    Then the result resolves to a ResolvedFeature with featureId=247, optionIds=[897]
    And no error is thrown

  Scenario: 999md adapter validates optionId exists under the feature
    Given a generic filter with kind="options", filterId=1193, featureId=247, optionIds=[999999]
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError(field="optionId", value="999999")

  Scenario: 999md adapter accepts valid range selection without unit
    Given a generic filter with kind="range", filterId=1201, featureId=588, min="2", max="4"
    When source999md.resolve(filter) is called
    Then the result has a ResolvedFeature with featureId=588, range={min:"2", max:"4"}
    And the feature has no unit property
    And no error is thrown

  Scenario: 999md adapter accepts valid range selection with unit
    Given a generic filter with kind="range", filterId=1073, featureId=244, unit="UNIT_METER_SQUARE", min="50", max="200"
    When source999md.resolve(filter) is called
    Then the result has a ResolvedFeature with featureId=244, unit="UNIT_METER_SQUARE", range={min:"50", max:"200"}
    And no error is thrown

  Scenario: 999md adapter validates unit exists in filter's units array
    Given a generic filter with kind="range", filterId=1073, featureId=244, unit="UNIT_PARSEC"
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError(field="unit", value="UNIT_PARSEC")

  Scenario: 999md adapter accepts valid boolean selection
    Given a generic filter with kind="boolean", filterId=4132, featureId=171
    When source999md.resolve(filter) is called
    Then the result has a ResolvedFeature with featureId=171 (no optionIds or range)
    And no error is thrown

  Scenario: 999md adapter merges multiple optionIds for the same featureId
    Given a generic filter with two selections targeting the same featureId:
      | kind    | filterId | featureId | optionIds |
      | options | 32       | 7         | [12900]   |
      | options | 32       | 7         | [12885]   |
    When source999md.resolve(filter) is called
    Then the result has one ResolvedFeature under filterId 32 with optionIds=[12900, 12885]

  Scenario: 999md adapter de-duplicates merged optionIds and preserves first-seen order
    Given a generic filter with two options selections on the same featureId:
      | kind    | filterId | featureId | optionIds      |
      | options | 32       | 8         | [13859, 13917] |
      | options | 32       | 8         | [13917, 13942] |
    When source999md.resolve(filter) is called
    Then the result has one ResolvedFeature under filterId 32, featureId 8
    And its optionIds are [13859, 13917, 13942] (13917 appears once, original order kept)

  Scenario: 999md adapter last-write-wins on repeated range for the same featureId
    Given a generic filter with two range selections on the same filterId 1073, featureId 244
    And the first has min="50" and the second has min="90"
    When source999md.resolve(filter) is called
    Then only the second range (min="90") survives
    And the first range is silently overwritten (no merge, no throw)

  Scenario: 999md adapter last-write-wins on a mixed-kind clash for the same featureId
    Given a generic filter with an options selection then a range selection on the same (filterId, featureId)
    When source999md.resolve(filter) is called
    Then the range feature overwrites the options feature for that (filterId, featureId)
    And no error is thrown

  Scenario: 999md adapter does NOT validate range bounds (trusts Zod for content)
    Given a generic filter with a range selection that has neither min nor max
    When source999md.resolve(filter) is called directly (bypassing Zod)
    Then it returns a ResolvedFeature with range={} and no error is thrown
    And the same applies to an options selection with optionIds=[] (yields optionIds:[] , no throw)

  Scenario: 999md adapter does NOT validate unit when unit is omitted
    Given a range selection with min/max but no unit, on a filter whose units array is empty or null
    When source999md.resolve(filter) is called
    Then validateUnit is skipped (only runs when sel.unit !== undefined)
    And no UnknownGenericFilterValueError(field="unit") is thrown

  Scenario: 999md adapter resolves an empty filters list without throwing
    Given a generic filter with category="house" and filters=[] (bypassing Zod .min(1))
    When source999md.resolve(filter) is called
    Then it returns searchInput with subCategoryId=1406 and filters=[]
    And no error is thrown

  Scenario: UnknownGenericFilterValueError message and stringified value
    Given source999md.resolve is called with an unknown optionId 99999
    When the error is thrown
    Then error.name is "UnknownGenericFilterValueError"
    And error.field is "optionId"
    And error.value is the string "99999"
    And error.message is 'Unknown optionId value "99999" — not in source mapping'

  Scenario: 999md adapter throws on the FIRST invalid selection and stops
    Given a generic filter whose second selection has a bad filterId and whose third has a bad optionId
    When source999md.resolve(filter) is called
    Then it throws on the second selection's filterId
    And the third selection is never evaluated (no aggregated error list, no partial result)

  Scenario: Default generic filter resolves correctly
    When source999md.resolve(defaultGenericFilter) is called
    Then no error is thrown
    And the result has a valid ResolvedSearchInput
    And subCategoryId is 1406 (house)
    And source is "AD_SOURCE_DESKTOP_REDESIGN"

  Scenario: Default filter uses correct region feature (feature 8, not 7)
    When source999md.resolve(defaultGenericFilter) is called
    Then the result includes a filter group with filterId=32
    And that group has a feature with featureId=8 (Localitate, not Regiune)
    And the feature includes optionIds for Chișinău localities [13859, 13917, 13942]

  Scenario: Default filter uses total area (filterId 1073), not living area
    When source999md.resolve(defaultGenericFilter) is called
    Then the result includes a filter group with filterId=1073 (total area)
    And the result does NOT include filterId=1194 (living area)

  Scenario: Operator edits filter in UI and persists via PATCH /api/filters
    Given a valid generic filter
    When the operator submits the form to PATCH /api/filters with { generic: filter }
    Then the server validates the filter via genericFilterSchema (Zod)
    And calls the active source's resolve() method
    And on success, upserts Setting["filter.generic"] with the filter JSON
    And returns 200 OK with the persisted filter

  Scenario: PATCH /api/filters returns 400 when source.resolve() throws
    Given a generic filter with an invalid filterId
    When the operator submits PATCH /api/filters
    Then source.resolve() throws UnknownGenericFilterValueError
    And the server catches it
    And returns 400 Bad Request with the error details (field, value)
    And the filter is NOT persisted

  Scenario: resolveActiveFilter() falls back when Setting["filter.generic"] is not found
    Given Setting["filter.generic"] has not been set in Postgres (getSetting returns null)
    When resolveActiveFilter() is called
    Then it does NOT call the active source's resolve()
    And it builds the ResolvedActiveFilter from the hardcoded FILTER.searchInput in src/config.ts
    And the returned generic field equals defaultGenericFilter
    And the returned sourceSlug is "999md"
    And no log line is emitted

  Scenario: resolveActiveFilter() falls back when Setting["filter.generic"] fails Zod parse
    Given Setting["filter.generic"] contains data that fails genericFilterSchema.safeParse (e.g. null or wrong shape)
    When resolveActiveFilter() is called
    Then it does NOT call the active source's resolve()
    And it falls back to the hardcoded FILTER.searchInput from src/config.ts
    And no WARN (or any) log line is emitted
    And it returns a valid ResolvedActiveFilter

  Scenario: resolveActiveFilter() falls back when active source is not registered
    Given ACTIVE_SOURCE_SLUG is "999md"
    And no adapter with slug "999md" is in the registry
    When resolveActiveFilter() is called
    Then getSource("999md") returns null
    And it falls back to the hardcoded FILTER from src/config.ts without calling any resolve()
    And no log line is emitted
    And it returns a ResolvedActiveFilter with sourceSlug "999md" and generic = defaultGenericFilter

  Scenario: resolveActiveFilter() propagates (does NOT catch) a resolve() throw on a poisoned persisted filter
    Given a source is registered
    And Setting["filter.generic"] parses against genericFilterSchema
    But it references a filterId that no longer exists in the taxonomy fixture
    When resolveActiveFilter() is called
    Then source.resolve() throws UnknownGenericFilterValueError(field="filterId")
    And the error propagates out of resolveActiveFilter() (there is no try/catch around resolve)
    And no fallback is applied for this case

  Scenario: resolveActiveFilter() never returns null
    When resolveActiveFilter() is called on any of the three fallback branches
    Then it resolves to a ResolvedActiveFilter object (never null, never undefined)
    And callers cannot rely on a null return to detect failure

  Scenario: Sweep uses the current ResolvedActiveFilter snapshot
    Given a ResolvedActiveFilter is resolved at the start of a sweep
    And during the sweep, the operator changes the persisted filter
    When the sweep completes
    Then it has used the original ResolvedActiveFilter, not the new one
    And the next sweep will pick up the new filter via resolveActiveFilter()

  Scenario: 999md adapter returns searchInput with source="AD_SOURCE_DESKTOP_REDESIGN"
    When source999md.resolve(any valid filter) is called
    Then the result.searchInput.source is always "AD_SOURCE_DESKTOP_REDESIGN"

  Scenario: New source adapter can be added by registering it in the REGISTRY
    Given a new source adapter sourceNewProvider
    When it is added to REGISTRY in src/sources/index.ts
    And exported from src/sources/index.ts
    Then listSources() includes the new source
    And getSource("newprovider") returns the adapter
    And tests can call source.resolve() without mocking

  Scenario: Category-specific filters are validated correctly
    Given a generic filter with category="house"
    And a filter selection with filterId=1191 (Etaj — apartment-only feature)
    When source999md.resolve(filter) is called
    Then it throws UnknownGenericFilterValueError because 1191 does not exist in filter-taxonomy.1406.json

  Scenario: Apartment-only filters are accepted for category="apartment"
    Given a generic filter with category="apartment"
    And a filter selection with filterId=1191 (Etaj — apartment-specific)
    When source999md.resolve(filter) is called
    Then no error is thrown
    And the filter is resolved

  Scenario: Sweep obtains a ResolvedActiveFilter before fetch/parse/persist
    When a sweep is initiated
    Then resolveActiveFilter() is called before any fetch/parse/persist
    And it returns a ResolvedActiveFilter (the three fallback branches guarantee a value; it never returns null)
    And the only way sweep start can fail here is an UnknownGenericFilterValueError propagating from resolve() on a poisoned persisted filter

  Scenario: HTTP layer catches UnknownGenericFilterValueError and returns structured 400
    Given source.resolve() throws UnknownGenericFilterValueError(field="optionId", value="99999")
    When the crawler or API error handler processes this exception
    Then the response is HTTP 400 Bad Request
    And the body includes { error: "Unknown optionId value 99999 — not in source mapping", field: "optionId", value: "99999" }
    And the operator sees this error message in the UI

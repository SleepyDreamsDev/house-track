Feature: Filter & taxonomy system (999.md parity)
  In order to map operator UI filters to source-specific API parameters
  As the crawler and operator UI
  I want to: resolve opaque 999.md filterId/featureId/optionId hierarchies via
  taxonomy, validate operator filter selections against live taxonomy data,
  surface humanized labels for display, and persist filter values on listings

  Background:
    Given the active source is '999md'
    And the category is 'house' (subCategoryId 1406)
    And the taxonomy JSON files are loaded (1406 = houses, 1404 = apartments)
    And the Postgres Setting table is available
    And the default filter is: category=house, region=8 (Chișinău), area >= 90 m², price <= 250k EUR

  # ─────────────────────────────────────────────────────────────────────────
  # STARTUP & FALLBACK (resolveActiveFilter)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Startup with no stored filter returns hardcoded defaults
    Given no Setting('filter.generic') row exists
    When resolveActiveFilter() is called
    Then it returns ResolvedActiveFilter with the hardcoded default filter
    And sourceSlug is '999md'

  Scenario: Startup with a valid stored filter reads from Postgres
    Given Setting('filter.generic') is stored as: { category: 'house', filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }, ...] }
    When resolveActiveFilter() is called
    Then it returns the resolved filter (validate all selections against taxonomy)
    And sourceSlug is '999md'

  Scenario: Stored filter fails Zod validation, fallback to defaults (silently)
    Given Setting('filter.generic') contains malformed JSON: { category: 'house', filters: [] }
    When resolveActiveFilter() is called
    Then validation fails (filters array cannot be empty per schema)
    And it returns the hardcoded default filter without throwing
    And NO warning is logged (filter-resolver.ts has no logger / no console call on the safeParse-failure path)

  Scenario: Stored filter has an unknown filterId, error propagates uncaught
    Given Setting('filter.generic') contains: { category: 'house', filters: [{ kind: 'options', filterId: 9999, featureId: 1, optionIds: [776] }] }
    When resolveActiveFilter() is called
    Then source999md.resolve() throws UnknownGenericFilterValueError('filterId', '9999')
    And resolveActiveFilter() does NOT catch the error — it propagates to the caller
    And resolveActiveFilter() does NOT log the error itself (no try/catch in filter-resolver.ts:18-38)
    And the caller (sweep/startup) is responsible for catching it; the human must fix via operator UI

  Scenario: Active source slug is not registered, return fallback before reading the Setting
    Given getSource(ACTIVE_SOURCE_SLUG) returns null (source not in REGISTRY)
    When resolveActiveFilter() is called
    Then it returns the hardcoded fallback immediately
    And it does NOT query the Setting table (the null-source guard runs first, filter-resolver.ts:21-23)
    And generic is defaultGenericFilter and searchInput is mapped from FILTER.searchInput

  # ─────────────────────────────────────────────────────────────────────────
  # FILTER RESOLUTION (999md.resolve)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Resolve a simple options filter
    Given a GenericFilter: { category: 'house', filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }] }
    When source999md.resolve() is called
    Then it validates:
      - category 'house' exists → subCategoryId 1406
      - filterId 16 exists in 1406 taxonomy
      - featureId 1 exists under filterId 16
      - optionId 776 exists under featureId 1
    And returns ResolvedFilter with searchInput.filters: [{ filterId: 16, features: [{ featureId: 1, optionIds: [776] }] }]

  Scenario: Resolve a range filter with unit
    Given a GenericFilter: { category: 'house', filters: [{ kind: 'range', filterId: 9441, featureId: 2, unit: 'UNIT_EUR', min: '100000', max: '250000' }] }
    When source999md.resolve() is called
    Then it validates:
      - filterId 9441 exists in taxonomy
      - featureId 2 exists under 9441
      - unit 'UNIT_EUR' is in the filter's units array
    And returns searchInput.filters: [{ filterId: 9441, features: [{ featureId: 2, unit: 'UNIT_EUR', range: { min: '100000', max: '250000' } }] }]

  Scenario: Resolve a boolean filter
    Given a GenericFilter: { category: 'house', filters: [{ kind: 'boolean', filterId: 5078, featureId: 1623 }] }
    When source999md.resolve() is called
    Then it validates filterId 5078 and featureId 1623 exist
    And returns searchInput.filters: [{ filterId: 5078, features: [{ featureId: 1623 }] }]

  Scenario: Resolve multiple filters, grouped by filterId
    Given a GenericFilter with 2 selections under filterId 32 (region), 1 under 9441 (price)
    When source999md.resolve() is called
    Then filters are merged: region features are combined under one filterId 32 entry
    And the output has exactly 2 filter entries (32 and 9441)

  Scenario: Duplicate options selections on the same featureId are unioned
    Given a GenericFilter with two 'options' selections, both filterId 32 featureId 8, optionIds [13859] then [13917, 13859]
    When source999md.resolve() is called
    Then mergeIntoFilters() unions the optionIds, de-duplicated and order-preserving
    And the single resolved feature 8 has optionIds [13859, 13917]

  Scenario: Duplicate non-options selections on the same featureId — later replaces earlier
    Given a GenericFilter with two 'range' selections, both filterId 9441 featureId 2, first max '250000' then max '300000'
    When source999md.resolve() is called
    Then the second selection silently replaces the first (no union, no error)
    And the resolved feature 2 range is { max: '300000' }

  Scenario: resolve() emits AD_SOURCE_DESKTOP_REDESIGN regardless of input
    Given any valid GenericFilter
    When source999md.resolve() is called
    Then searchInput.source is the literal 'AD_SOURCE_DESKTOP_REDESIGN'
    And the legacy 'AD_SOURCE_DESKTOP' union member is never produced by this adapter

  Scenario: Unknown category maps to no taxonomy, throws category error
    Given a GenericFilter whose category is not in CATEGORY_SUBCATEGORY_MAP
    When source999md.resolve() is called
    Then it throws UnknownGenericFilterValueError('category', <value>)
    And no searchInput is returned (Zod normally blocks this; the guard is defense-in-depth)

  Scenario: Invalid optionId in the filter, throw UnknownGenericFilterValueError
    Given a GenericFilter with optionId 9999 (does not exist under featureId 1)
    When source999md.resolve() is called
    Then it throws UnknownGenericFilterValueError('optionId', '9999')

  Scenario: Range filter with no min/max, fail validation
    Given a GenericFilter with range selection but neither min nor max
    When source999md.resolve() is called
    Then Zod validation fails (refine rule: must have at least one of min or max)

  Scenario: Range filter with min > max, fail validation
    Given a GenericFilter with min: '300000', max: '100000'
    When source999md.resolve() is called
    Then Zod validation fails (refine rule: min ≤ max)

  Scenario: Range filter with a non-numeric bound fails the min ≤ max refine
    Given a range selection with min: 'abc', max: '100000'
    When Zod validates against rangeSelectionSchema
    Then the first refine passes (min is defined) but the second refine fails
    Because Number('abc') is NaN and NaN <= 100000 is false
    And the (misleading) error message is 'range min must be ≤ max'

  Scenario: Range filter with only one bound skips the ordering refine
    Given a range selection with max: '250000' and no min
    When Zod validates
    Then the ordering refine short-circuits to true (min is undefined)
    And validation passes

  # ─────────────────────────────────────────────────────────────────────────
  # SETTING MUTATION (setSetting)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Operator sets a valid filter via PUT /api/filter
    Given the operator submits { category: 'house', filters: [{ kind: 'options', filterId: 16, featureId: 1, optionIds: [776] }, ...] }
    When the API validates and calls setSetting('filter.generic', filter)
    Then Zod validation passes
    And source999md.resolve() validates the filter (no unknown IDs)
    And the filter is written to Postgres Setting table
    And the API returns 200 with the ResolvedActiveFilter

  Scenario: Operator submits a filter with an unknown optionId
    Given the operator submits a filter with optionId 9999
    When setSetting('filter.generic', filter) is called
    Then source999md.resolve() throws UnknownGenericFilterValueError
    And the API returns 400 with field + value in the response
    And no write occurs

  Scenario: Cross-key bounds check: indexTickIntervalMinutesMin > Max
    Given indexTickIntervalMinutesMax is currently 120
    When setSetting('sweep.indexTickIntervalMinutesMin', 150) is called
    Then pairedBounds validation fails
    And it throws Error('sweep.indexTickIntervalMinutesMin (150) cannot exceed sweep.indexTickIntervalMinutesMax (120). Update sweep.indexTickIntervalMinutesMax first.')
    And no write occurs

  Scenario: Cross-key bounds check: update Max first, then Min
    Given indexTickIntervalMinutesMax is 120
    When setSetting('sweep.indexTickIntervalMinutesMax', 180) is called
    Then write succeeds
    And setSetting('sweep.indexTickIntervalMinutesMin', 150) is called
    Then write succeeds

  Scenario: Cross-key bounds check: writing Max below the current Min is rejected
    Given indexTickIntervalMinutesMin is currently 60
    When setSetting('sweep.indexTickIntervalMinutesMax', 30) is called
    Then pairedBounds validation fails on the max-direction branch
    And it throws Error('sweep.indexTickIntervalMinutesMax (30) cannot be less than sweep.indexTickIntervalMinutesMin (60). Update sweep.indexTickIntervalMinutesMin first.')
    And no write occurs

  Scenario: Cross-key bounds also guard the detail-trickle pair
    Given detailTrickleIntervalSecondsMax is currently 360
    When setSetting('sweep.detailTrickleIntervalSecondsMin', 400) is called
    Then it throws because 400 > 360 (Update sweep.detailTrickleIntervalSecondsMax first.)
    And no write occurs

  Scenario: Zod schema validation runs before the cross-key bounds check
    When setSetting('sweep.indexTickIntervalMinutesMin', 'not-a-number') is called
    Then schema.parse throws a ZodError first
    And the partner-value lookup / bounds comparison never runs
    And no write occurs

  Scenario: setSetting rejects a value that violates its own schema
    When setSetting('sweep.quietHoursStart', 25) is called
    Then Zod validation fails (z.number().int().min(0).max(23))
    And no write occurs

  Scenario: Setting an unknown key throws error
    When setSetting('garbage.key', 'value') is called
    Then it throws Error('Unknown setting key: garbage.key')

  # ─────────────────────────────────────────────────────────────────────────
  # CATEGORY SWITCHING
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Operator switches category from house to apartment
    Given a stored GenericFilter with category changed to 'apartment' and filterId 16 carried over
    When source999md.resolve() runs (via the API preview or the next resolveActiveFilter())
    Then resolve() looks up CATEGORY_SUBCATEGORY_MAP['apartment'] = 1404 and uses TAXONOMY_BY_SUBCATEGORY[1404]
    And every selection is re-validated against the 1404 filter map (getFilter → getFeature → validateOptionId)
    And if filterId 16 does not exist in 1404, getFilter throws UnknownGenericFilterValueError('filterId', '16')
    And note: validation is driven by the category field INSIDE the GenericFilter — resolveActiveFilter() takes no category argument

  Scenario: Apartment category maps to subCategoryId 1404
    Given a GenericFilter: { category: 'apartment', filters: [...] }
    When source999md.resolve() is called
    Then it looks up CATEGORY_SUBCATEGORY_MAP['apartment'] = 1404
    And uses the 1404 taxonomy JSON for validation

  # ─────────────────────────────────────────────────────────────────────────
  # TAXONOMY LABELS & UI POPULATION
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Fetch taxonomy labels for filter form
    When GET /api/filter/taxonomy?subCategoryId=1406 is called
    Then buildTaxonomyResponse(1406) walks the taxonomy JSON
    And returns TaxonomyFilter[]:
      [
        { filterId: 16, label: 'Type of offer', kind: 'options', features: [...] },
        { filterId: 32, label: 'Region', kind: 'options', features: [...] },
        { filterId: 9441, label: 'Price', kind: 'range', features: [...] }
      ]

  Scenario: Taxonomy response includes option labels
    Given the 1406 taxonomy has filterId 16, featureId 1, optionId 776, label "Vând (for sale)"
    When buildTaxonomyResponse(1406) is called
    Then the response includes: { featureId: 1, label: 'Offer type', options: [{ id: 776, label: 'Vând (for sale)' }, ...] }

  Scenario: Taxonomy response includes range filter units
    Given the 1406 taxonomy has filterId 9441 with units: ['UNIT_EUR', 'UNIT_MDL', 'UNIT_USD']
    When buildTaxonomyResponse(1406) is called
    Then the feature includes: { featureId: 2, label: 'Total price', units: [...] }

  Scenario: Taxonomy label is missing, fallback to numeric ID
    Given a filterId 9999 exists in the searchInput but not in the taxonomy JSON
    When the SPA renders the filter
    Then it displays the numeric ID (e.g., "9999") instead of a label
    And no error is thrown

  Scenario: Taxonomy JSON is corrupted, buildIndex skips malformed nodes
    Given a filter entry has id: 'not a number'
    When buildIndex(json) walks the structure
    Then it checks typeof f.id !== 'number' && continue
    And skips the malformed entry without throwing

  Scenario: buildTaxonomyResponse drops filters whose type is unrecognized
    Given a well-formed filter whose type is not in FILTER_KIND_MAP (e.g. a date/checkbox FILTER_TYPE_* or missing type)
    When buildTaxonomyResponse(1406) is called
    Then FILTER_KIND_MAP[type] is undefined
    And the filter is skipped (if (!kind) continue), never reaching the SPA
    And only 'options' / 'range' / 'boolean' filters appear in the response

  Scenario: buildTaxonomyResponse emits scalar unit for a single-unit range filter
    Given range filterId 1073 (area) has units: ['UNIT_METER_SQUARE']
    When buildTaxonomyResponse(1406) is called
    Then each feature is { featureId, label, unit: 'UNIT_METER_SQUARE' } (scalar unit, not units[])

  Scenario: buildTaxonomyResponse emits units[] for a multi-unit range filter
    Given range filterId 9441 (price) has units: ['UNIT_EUR', 'UNIT_MDL', 'UNIT_USD']
    When buildTaxonomyResponse(1406) is called
    Then each feature is { featureId, label, units: ['UNIT_EUR', 'UNIT_MDL', 'UNIT_USD'] } (array, no scalar unit)

  Scenario: buildTaxonomyResponse omits unit keys for a range filter with no units
    Given a range filter whose units is null or empty
    When buildTaxonomyResponse(1406) is called
    Then the feature has neither unit nor units (just { featureId, label })

  Scenario: buildTaxonomyResponse falls back to String(id) when a label is missing
    Given a filter/feature/option with no title.translated
    When buildTaxonomyResponse is called
    Then its label is String(id) (the numeric id rendered as text), not null and not an empty string

  # ─────────────────────────────────────────────────────────────────────────
  # PARSE & PERSIST (on detail fetch)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Parse detail page, extract FeatureValues, enrich listing
    Given a detail page response with FeatureValue nodes: [{ featureId: 1, optionId: 776 }, { featureId: 2, numeric: '125000' }, ...]
    When persistDetail() is called
    Then for each FeatureValue, it:
      1. Resolves featureId → filterId via the LUT (bootstrap + captured taxonomy)
      2. Creates a ListingFilterValue row: { listingId, filterId, featureId, optionId, textValue, numericValue }
      3. Sets Listing.filterValuesEnrichedAt = now()
    And subsequent sweeps can use filterValuesEnrichedAt to skip enriched listings

  Scenario: Parse detail with unknown featureId, log and continue
    Given a FeatureValue with featureId 9999 (not in the LUT)
    When persistDetail() is called
    Then the LUT lookup returns undefined
    And the row is skipped with a warning log
    And the sweep continues (one missing value does not kill it)

  Scenario: Bootstrap LUT has featureId 1 → filterId 16
    Given bootstrapLutFromConfig() builds from FILTER.searchInput.filters
    When it walks the hardcoded filters
    Then it seeds: featureId 1 → filterId 16 (offer type)
    And featureId 7 → filterId 32 (region, deprecated; feature 8 is new)
    And featureId 2 → filterId 9441 (price)

  Scenario: bootstrapLutFromConfig seeds region feature 7, not feature 8
    Given FILTER.searchInput.filters uses { filterId: 32, features: [{ featureId: 7 }] } (config.ts:51)
    When bootstrapLutFromConfig() is called
    Then the LUT contains 7 → 32 (the geo feature listings actually carry)
    And it does NOT contain 8 → 32 (feature 8 / Localitate lives only in defaultGenericFilter, not FILTER.searchInput)
    And only the three config anchors are seeded: 1 → 16, 7 → 32, 2 → 9441

  Scenario: Merge LUTs: captured taxonomy wins on conflict
    Given bootstrap LUT: { 1: 16, 7: 32, ... }
    And captured LUT: { 1: 16, 8: 32, 244: 1073, ... } (note: featureId 8 is the new region)
    When mergeLuts(bootstrap, captured) is called
    Then output is: { 1: 16, 7: 32, 8: 32, 244: 1073, ... } (captured 8 is added, bootstrap 7 is kept)
    And captured overwrites bootstrap on the SAME featureId key only (mergeLuts keys on featureId, not filterId)

  Scenario: parseTaxonomyResponse walks any tree shape and emits featureId edges
    Given an arbitrary JSON tree with a node having a numeric filterId (or id) and a features[] array
    When parseTaxonomyResponse(json) is called
    Then for each features[] entry it reads featureId (falling back to id) via pickNumber
    And emits featureId → filterId edges, recursing into every object value
    And nodes whose filterId/id is non-finite or non-numeric are skipped (pickNumber returns null)
    And the walker is intentionally loose — the real fixture shape is TBD and should be tightened when captured

  # ─────────────────────────────────────────────────────────────────────────
  # FILTER VALIDATION & ERROR HANDLING
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: GenericFilter requires category
    Given a filter without the category field
    When Zod validates against genericFilterSchema
    Then it fails: expected 'house' | 'apartment'

  Scenario: GenericFilter requires non-empty filters array
    Given a filter with filters: []
    When Zod validates
    Then it fails: array must have at least 1 element

  Scenario: FilterSelection discriminated union: unknown kind
    Given a selection with kind: 'unknown'
    When Zod validates against filterSelectionSchema
    Then it fails: invalid discriminator value 'unknown'

  Scenario: Options selection requires at least one optionId
    Given a selection with kind: 'options', optionIds: []
    When Zod validates against optionsSelectionSchema
    Then it fails: array must have at least 1 element

  Scenario: Resolve atomicity: all-or-nothing
    Given a filter with 3 selections; one has an invalid optionId
    When source999md.resolve() is called
    Then it throws UnknownGenericFilterValueError (does not return a partial resolution)
    And the operator sees exactly which field is invalid

  # ─────────────────────────────────────────────────────────────────────────
  # SETTING FALLBACK & DEFAULTS
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: getSetting fallback parameter OUTRANKS the defaultValues map
    Given no Setting('politeness.baseDelayMs') row in Postgres
    And defaultValues['politeness.baseDelayMs'] is 8000
    When getSetting('politeness.baseDelayMs', 12345) is called
    Then it returns 12345 (the explicit fallback wins over defaultValues, settings.ts:296-302)
    And it does NOT return 8000

  Scenario: getSetting with fallback undefined falls through to defaultValues
    Given no Setting('politeness.baseDelayMs') row in Postgres
    When getSetting('politeness.baseDelayMs', undefined) is called
    Then the fallback guard (fallback !== undefined) is false
    And it returns defaultValues['politeness.baseDelayMs'] = 8000
    And passing undefined is indistinguishable from passing no fallback

  Scenario: getSetting uses fallback parameter when key does not exist
    Given no Setting('filter.generic') row
    When getSetting('filter.generic', null) is called
    Then null !== undefined so the fallback guard passes
    And it returns null (the fallback) without consulting defaultValues

  Scenario: getSetting returns a committed null row over the fallback
    Given a Setting('filter.generic') row exists with valueJson = null
    When getSetting('filter.generic', defaultGenericFilter) is called
    Then the DB row is found (setting !== null && setting !== undefined is true for the row object)
    And it returns the row's valueJson (null), NOT the fallback

  Scenario: getSetting throws when key not found and no fallback provided
    Given no Setting('garbage.key') row
    When getSetting('garbage.key') is called (no fallback, no defaultValues entry)
    Then it throws Error('Setting key "garbage.key" not found and no default provided')

  Scenario: listSettings returns all keys except filter.generic
    When listSettings() is called
    Then it returns all keys from settingSchemas except 'filter.generic'
    And each entry includes: key, value, default, schema, group, kind, label, hint

  # ─────────────────────────────────────────────────────────────────────────
  # SOURCE ADAPTER REGISTRY
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: listSources returns all registered sources
    When listSources() is called
    Then it returns [source999md] (currently)

  Scenario: getSource returns the adapter by slug
    When getSource('999md') is called
    Then it returns source999md
    And getSource('nonexistent') returns null

  Scenario: ACTIVE_SOURCE_SLUG is hardcoded to '999md'
    When resolveActiveFilter() is called
    Then it uses ACTIVE_SOURCE_SLUG
    And loads getSource('999md')

  # ─────────────────────────────────────────────────────────────────────────
  # PRICE NORMALIZATION (external to filter layer)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Filter carries price as string range, crawler normalizes
    Given a filter with price range: { min: '100000', max: '250000', unit: 'UNIT_EUR' }
    When the crawler parses a listing priced at "190.000 EUR"
    Then it stores:
      - priceRaw: '190.000 EUR'
      - priceEur: 190000 (normalized int)
    And the filter does not perform unit conversion

  Scenario: Price range validation is on string bounds, not normalized values
    Given a filter with price range: { min: '100000', max: '250000' }
    When Zod validates (range.min ≤ range.max)
    Then it compares Number('100000') ≤ Number('250000')
    And does not know about currency conversion

  # ─────────────────────────────────────────────────────────────────────────
  # SOURCE DETERMINISM
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: source999md.resolve is deterministic
    Given a GenericFilter F
    When source999md.resolve(F) is called twice
    Then both calls return identical ResolvedFilter objects
    And the result depends only on F and the taxonomy, not on external state

  # ─────────────────────────────────────────────────────────────────────────
  # EDGE CASE: EMPTY CATEGORY TAXONOMY
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Get taxonomy for a category with no JSON file
    Given subCategoryId 9999 has no corresponding taxonomy JSON
    When buildTaxonomyResponse(9999) is called
    Then getIndex(9999) returns undefined
    And the function returns [] (empty list)
    And the SPA renders an empty form (edge case)

  # ─────────────────────────────────────────────────────────────────────────
  # OPERATIONAL: OPERATOR WORKFLOWS
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Operator expands price cap from 250k to 300k EUR
    Given the current filter has max: '250000' under filterId 9441
    When the operator navigates to Settings > Filters
    And edits the price range to max: '300000'
    And clicks Save
    Then PUT /api/filter is called with the updated GenericFilter
    And setSetting('filter.generic', ...) writes to Postgres
    And on the next cron tick, resolveActiveFilter() reads the new value
    And the next sweep uses the new price cap

  Scenario: Operator adds a new location (Codru neighborhood)
    Given the current filter has region selections
    When the operator checks GET /api/filter/taxonomy?subCategoryId=1406
    And finds filterId 32, Codru = optionId 13942
    And adds a new selection to the filters array
    Then PUT /api/filter writes the extended filter
    And the next sweep includes Codru in the search

  Scenario Outline: Taxonomy refresh is manual (PR 2 planned)
    Given 999.md's taxonomy has updated (new optionIds)
    And the SPA's static taxonomy JSON is stale
    When the operator triggers /api/filter/taxonomy/refresh (manual)
    Then the crawler fetches GetFilterTaxonomy GraphQL query
    And updates the in-memory LUT
    And the SPA displays new options for selection
    Examples:
      | scenario |
      | daily auto-refresh (future) |
      | manual operator trigger |
      | per-sweep refresh (expensive) |

  # ─────────────────────────────────────────────────────────────────────────
  # TIMING & ASYNC CONSISTENCY
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Sweep reads committed filter update atomically
    Given the operator updates filter at 09:15
    And the next cron tick fires at 09:30
    When the sweep calls resolveActiveFilter()
    Then Postgres ACID isolation ensures the sweep reads either the old or new value atomically
    And no partial or corrupted read occurs
    And if the write has not yet committed, the sweep uses the old value (expected timing variability)


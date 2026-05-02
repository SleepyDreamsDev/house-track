Feature: Setting and Source tables + getSetting
  As an operator
  I want to store runtime-mutable settings in the database
  So that I can tune the crawler without editing source code or redeploying

  Scenario: Get a setting with a value stored in the database
    Given a Setting row with key "politeness.baseDelayMs" and value 12000
    When I call getSetting("politeness.baseDelayMs")
    Then it returns 12000

  Scenario: Fall back to defaults when setting is not in database
    Given no Setting row for key "politeness.baseDelayMs"
    When I call getSetting("politeness.baseDelayMs")
    Then it returns the default from config.ts (8000)

  Scenario: Store a new setting via setSetting
    Given no Setting row for key "sweep.maxPagesPerSweep"
    When I call setSetting("sweep.maxPagesPerSweep", 75)
    Then the database has a Setting row with key "sweep.maxPagesPerSweep" and value 75
    And getSetting("sweep.maxPagesPerSweep") returns 75

  Scenario: Update an existing setting via setSetting
    Given a Setting row with key "filter.maxPriceEur" and value 300000
    When I call setSetting("filter.maxPriceEur", 200000)
    Then the database has a Setting row with key "filter.maxPriceEur" and value 200000
    And getSetting("filter.maxPriceEur") returns 200000

  Scenario: Validate setting writes against zod schemas
    Given no Setting row for key "politeness.baseDelayMs"
    When I call setSetting("politeness.baseDelayMs", -1000)
    Then it throws a validation error

  Scenario: List all settings with their current and default values
    Given Settings rows: {"politeness.baseDelayMs": 10000, "sweep.maxPagesPerSweep": 75}
    And defaults from config.ts
    When I call listSettings()
    Then it returns an array with key, value, default, and zod schema for each setting

  Scenario: Persist Source table with adapter metadata
    When I insert a Source row with slug "999md", baseUrl "https://999.md", adapterKey "999md", enabled true
    Then the database has a Source row with id, slug, name, baseUrl, adapterKey, enabled, politenessOverridesJson, filterOverridesJson, createdAt, updatedAt

  Scenario: Refactor sweep.ts to read sweep settings from getSetting
    Given sweep settings in the database: {"sweep.maxPagesPerSweep": 75, "sweep.backfillPerSweep": 40}
    When runSweep executes
    Then it reads maxPagesPerSweep and backfillPerSweep from getSetting, not from config.ts

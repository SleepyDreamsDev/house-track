Feature: Settings metadata enrichment
  As a Settings page frontend
  I want settings to include metadata (group, kind, unit, options, label, hint)
  So that the UI can render typed controls (numbers w/ units, selects, dropdowns)

  Background:
    Given the settings database is initialized with default values

  Scenario: listSettings() returns metadata fields
    When I call listSettings()
    Then each setting includes: key, value, default, group, kind
    And politeness.baseDelayMs has group='Politeness', kind='number', unit='ms'
    And log.level has group='Logging', kind='select', options=['debug','info','warn','error']

  Scenario: GET /api/settings includes metadata in response
    When I GET /api/settings
    Then the response is a JSON array
    And each item has: key, value, default, group, kind
    And politeness.baseDelayMs includes: unit='ms'
    And filter.maxAreaSqm includes: unit='m²'
    And log.level includes: options=['debug','info','warn','error']

  Scenario: Metadata does not break existing consumers
    When I GET /api/settings
    And I filter to politeness.baseDelayMs
    Then value and default fields match pre-metadata format
    And the object still has key, value, default (backward compat)

  Scenario: All settings have correct group assignments
    When I call listSettings()
    Then settings are grouped as:
      | key                                 | group           |
      | politeness.baseDelayMs              | Politeness      |
      | politeness.jitterMs                 | Politeness      |
      | politeness.detailDelayMs            | Politeness      |
      | sweep.maxPagesPerSweep              | Sweep           |
      | sweep.backfillPerSweep              | Sweep           |
      | sweep.cronSchedule                  | Sweep           |
      | circuit.consecutiveFailureThreshold | Circuit breaker |
      | circuit.pauseDurationMs             | Circuit breaker |
      | filter.maxPriceEur                  | Filter          |
      | filter.maxAreaSqm                   | Filter          |
      | log.level                           | Logging         |

  Scenario: log.level select control has correct options
    When I GET /api/settings
    And I filter to log.level
    Then kind='select'
    And options=['debug','info','warn','error']

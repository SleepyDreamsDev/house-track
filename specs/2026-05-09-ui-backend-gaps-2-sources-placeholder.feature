Feature: GET /api/sources exposes a placeholder flag for non-implemented adapters

  As a frontend that needs to disable controls for unsupported sources
  I want each source row to carry a placeholder boolean
  So that I can render a "not implemented" badge and disable the toggle

  Scenario: 999md source is not a placeholder
    Given a Source row with adapterKey = "999md"
    When I GET /api/sources
    Then the response item for that source has placeholder = false

  Scenario: Non-999md source is flagged as placeholder
    Given a Source row with adapterKey = "lara" (or any value other than "999md")
    When I GET /api/sources
    Then the response item for that source has placeholder = true

  Scenario: Existing fields remain in the response
    When I GET /api/sources
    Then each item still includes id, slug, name, baseUrl, adapterKey, enabled,
      politenessOverridesJson, filterOverridesJson, createdAt, updatedAt

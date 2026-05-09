Feature: Settings Sources toggle wires up to PATCH /api/sources/:id

  As an operator
  I want the enable/disable toggle on the Sources card to actually work
  So that I can pause a source without editing the database

  Background:
    Given the Settings page is rendered with at least one source returned by GET /api/sources

  Scenario: Toggling an enabled source disables it via the API
    Given a source row whose enabled flag is true
    When I click its Toggle
    Then a PATCH /api/sources/:id is sent with body { enabled: false }
    And the ['sources'] query is invalidated on success so the row reflects the new state

  Scenario: Toggling a disabled source enables it via the API
    Given a source row whose enabled flag is false
    When I click its Toggle
    Then a PATCH /api/sources/:id is sent with body { enabled: true }
    And the ['sources'] query is invalidated on success

  Scenario: Placeholder sources cannot be toggled
    Given a source row whose placeholder flag is true
    When I render the Toggle
    Then the Toggle is disabled and clicking it sends no request

Feature: Slice 7 — Documentation for operator UI and phase completion
  As an operator
  I want clear documentation on how to run and use the crawler console
  And understand what has been delivered in phases 2–6

  Scenario: Operator runbook exists and covers all UI pages
    Given I navigate to docs/operator-ui.md
    Then I see sections for Dashboard, Houses, Sweeps, and Settings pages
    And I see instructions for common operations (pause crawler, change settings, export listings)
    And I see Grafana dashboard configuration and access details
    And I see development and troubleshooting guides

  Scenario: Phase 4 completion is documented in poc-spec.md
    Given I read docs/poc-spec.md
    Then I see a Phase 4 section summarizing what was delivered
    And it mentions Postgres migration, settings layer, Hono API, Vite SPA, and Grafana
    And it cross-links to docs/operator-ui.md for how to run

  Scenario: CLAUDE.md reflects the modern stack
    Given I read CLAUDE.md
    Then the Stack section lists Postgres, Hono, Vite, React, Tailwind, and Grafana
    Then the Commands section reflects the new dev/docker workflow
    And the file is ≤120 lines
    And scope list includes `web` and relevant domains

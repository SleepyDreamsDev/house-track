Feature: Frontend visual pass with design system
  As an operator using the House Track UI
  I want the application to have a cohesive visual design
  So that the interface feels polished, scannable, and operationally efficient

  Scenario: Design tokens are defined and consistent
    Given the design system is initialized
    When I view the application
    Then typography follows the defined scale (sm, base, lg, xl, 2xl)
    And spacing follows the defined scale (0.5rem, 1rem, 1.5rem, 2rem, 3rem)
    And colors use a monochrome palette with a single accent color
    And the accent color is used for interactive elements and state indicators

  Scenario: Dashboard page is visually refined
    Given I navigate to the Dashboard page
    When the page loads
    Then the status pills are inline with descriptive text
    And the "Last Sweep" and "Circuit State" tiles show key metrics prominently
    And the layout is balanced with proper spacing
    And loading and error states are displayed appropriately

  Scenario: Listings table is dense and scannable
    Given I navigate to the Listings page
    When the listings table displays
    Then table rows are compact with consistent vertical spacing
    And column headers are clearly distinguished from data rows
    And numeric values (price, area) are right-aligned
    And the filter controls are grouped in a card above the table
    And pagination controls are clear and properly spaced

  Scenario: Sweeps table shows status at a glance
    Given I navigate to the Sweeps page
    When the sweeps table displays
    Then status badges use appropriate colors (success=green, error=red, warning=yellow)
    And the "Reset Circuit Breaker" button is prominent and destructive-styled
    And expandable rows reveal details with clear visual hierarchy
    And timestamps are consistently formatted

  Scenario: Settings form is organized with field grouping
    Given I navigate to the Settings page
    When the page loads
    Then Crawler Tuning settings are grouped in a card
    And Sources are grouped in a separate card
    And Global Filter is in its own card
    And each section has a clear heading
    And form controls are consistently styled

  Scenario: Navigation and layout are consistent
    Given I view the application layout
    When I examine the sidebar navigation
    Then the active nav item is clearly highlighted with the accent color
    Then inactive nav items show clear hover states
    And the main content area has consistent padding
    And the app header includes branding

  Scenario: Empty, loading, and error states are visible
    Given the application loads
    When data is loading or errors occur
    Then loading states show appropriate feedback
    And error messages are visually distinct
    And empty states are clearly communicated

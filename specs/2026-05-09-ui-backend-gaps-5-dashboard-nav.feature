Feature: Dashboard "View all houses →" button navigates to /listings

  As an operator scanning the Dashboard's New today section
  I want the "View all houses →" button to take me to the Houses page
  So that I can drill from the summary into the full filterable list

  Scenario: Clicking the button navigates to /listings
    Given the Dashboard is rendered
    When I click the "View all houses →" button
    Then the router navigates to /listings

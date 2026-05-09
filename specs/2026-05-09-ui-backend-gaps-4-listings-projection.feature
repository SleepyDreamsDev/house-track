Feature: searchListings projection includes UI-rendered fields

  As the Houses page rendering rich listing cards
  I want GET /api/listings to return landSqm, street, floors, yearBuilt, priceWas, isNew
  So that the cards stop rendering blank "land", "built", NEW badges and price-drop strikes

  Scenario: New fields are present in each row
    When I call searchListings against a listing with all detail fields set
    Then the returned row includes landSqm, street, floors, yearBuilt

  Scenario: priceWas reflects the most recent prior PriceSnapshot
    Given a listing with current priceEur = 90000
    And a PriceSnapshot from 3 days ago with priceEur = 100000
    When I call searchListings
    Then the returned row has priceWas = 100000

  Scenario: priceWas is null when no prior snapshot exists
    Given a listing with no PriceSnapshot rows
    When I call searchListings
    Then the returned row has priceWas = null

  Scenario: isNew is true when firstSeenAt is within the last 24h
    Given a listing whose firstSeenAt = now - 6h
    When I call searchListings
    Then the returned row has isNew = true

  Scenario: isNew is false when firstSeenAt is older than 24h
    Given a listing whose firstSeenAt = now - 48h
    When I call searchListings
    Then the returned row has isNew = false

  Scenario: getListing (MCP consumer) is not regressed
    When I call getListing for an existing listing
    Then the response shape and field set is identical to before this change

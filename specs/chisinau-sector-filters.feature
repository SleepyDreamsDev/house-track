Feature: Chișinău sector filter
  Derive city sectors from listing text and filter Listings/Analytics by them.

  Scenario: Explicit sector mention classifies a Chișinău listing
    Given a listing with district "Chișinău" and title "Casă cu 3 niveluri, sect. Centru"
    When the sector is derived
    Then the sector is "Centru"

  Scenario: Bare keyword in the street classifies a Chișinău listing
    Given a listing with district "Chișinău" and street "str. Buiucani"
    When the sector is derived
    Then the sector is "Buiucani"

  Scenario: Gazetteer neighborhood classifies when no sector keyword is present
    Given a listing with district "Chișinău" and street "str. Sculeni"
    When the sector is derived
    Then the sector is "Buiucani"

  Scenario: A Chișinău listing with no signal is left unclassified
    Given a listing with district "Chișinău" and street "str. Nuferilor" and no sector words
    When the sector is derived
    Then the sector is null

  Scenario: A commune listing is never assigned a sector
    Given a listing with district "Durlești"
    When the sector is derived
    Then the sector is null

  Scenario: Listings can be filtered to a single sector
    Given active Chișinău listings in sectors "Centru" and "Botanica"
    When I request "/api/listings?sector=Centru"
    Then only the "Centru" listings are returned

  Scenario: Sector facet lists only sectors that have listings
    Given active Chișinău listings only in sector "Ciocana"
    When I request "/api/listings/facets"
    Then the sectors facet contains "Ciocana" and no other sector

  Scenario: An empty sector parameter is rejected
    When I request "/api/listings?sector="
    Then the response status is 400

  Scenario: Analytics accepts the same sector filter
    Given active Chișinău listings in sectors "Centru" and "Ciocana"
    When I request "/api/analytics/overview?sector=Centru"
    Then the analytics slice covers only the "Centru" listings

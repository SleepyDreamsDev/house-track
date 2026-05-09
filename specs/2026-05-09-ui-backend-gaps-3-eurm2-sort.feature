Feature: searchListings sort=eurm2 actually sorts by €/m² ascending

  As a user filtering for the best price-per-square-meter
  I want sort=eurm2 to return cheapest-€/m² first
  So that the "€/m² ↑" tab on the Houses page is not a no-op

  Scenario: Listings with priceEur and areaSqm sort ascending by ratio
    Given listings A (priceEur=100000, areaSqm=50)  # €2000/m²
    And listings B (priceEur=120000, areaSqm=80)    # €1500/m²
    And listings C (priceEur=90000,  areaSqm=30)    # €3000/m²
    When I call searchListings with sort = "eurm2"
    Then the order is B, A, C  # ascending €/m²

  Scenario: Listings with null or zero areaSqm are excluded or pushed last
    Given listings X (priceEur=100000, areaSqm=null)
    And listings Y (priceEur=200000, areaSqm=0)
    And listings Z (priceEur=150000, areaSqm=50)    # €3000/m²
    When I call searchListings with sort = "eurm2"
    Then Z appears before X and Y (rows missing area do not pollute the top)

  Scenario: Listings with null priceEur are excluded or pushed last
    Given listings P (priceEur=null, areaSqm=50)
    And listings Q (priceEur=100000, areaSqm=50)    # €2000/m²
    When I call searchListings with sort = "eurm2"
    Then Q appears before P

  Scenario: Other sort modes are unchanged
    When I call searchListings with sort = "newest"
    Then the order is by firstSeenAt desc as before
    When I call searchListings with sort = "price"
    Then the order is by priceEur asc as before

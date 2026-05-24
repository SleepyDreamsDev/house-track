Feature: Mislabel detection for house listings
  As an operator browsing the 999.md house catalog
  I want listings that are really duplex/townhouse/villa, or really in another raion,
  to be flagged
  So that I can spot misadvertised properties and optionally hide them

  # ── Type detection (src/lib/listing-classification.ts: detectType) ──

  Scenario: A plain house title stays House
    Given a listing titled "Casă, 140 m², Colonița"
    When I derive its type
    Then the derived type is "House"

  Scenario: A duplex mention anywhere wins
    Given a listing whose text contains "Vând duplex nou"
    When I derive its type
    Then the derived type is "Duplex"

  Scenario: "Town House" with a space is detected as Townhouse
    Given a listing titled "Casa de tip Town House"
    When I derive its type
    Then the derived type is "Townhouse"

  Scenario: A Cyrillic таунхаус is detected as Townhouse
    Given a listing whose text contains "таунхаус"
    When I derive its type
    Then the derived type is "Townhouse"

  Scenario: A vilă is detected as Villa
    Given a listing titled "Vilă de lux, 300 m²"
    When I derive its type
    Then the derived type is "Villa"

  Scenario: Duplex outranks townhouse when both appear
    Given a listing whose text contains "duplex în ansamblu de townhouse"
    When I derive its type
    Then the derived type is "Duplex"

  Scenario: A negated "nu este duplex" is not flagged
    Given a listing whose text contains "Casă individuală, nu este duplex"
    When I derive its type
    Then the derived type is "House"

  Scenario: A proximity "lângă un townhouse" is not flagged
    Given a listing whose text contains "Casă amplasată lângă un townhouse"
    When I derive its type
    Then the derived type is "House"

  Scenario: A keyword inside a larger word is not matched
    Given a listing whose text contains "acoperiș duplexat oarecare"
    When I derive its type
    Then the derived type is "House"

  # ── Region detection (src/lib/listing-classification.ts: isRegionMismatch, fold) ──

  Scenario: A locality outside the municipality is a region mismatch
    Given a listing with district "Ialoveni"
    When I check the region
    Then it is a region mismatch

  Scenario: A municipality commune is not a region mismatch
    Given a listing with district "Bîc"
    When I check the region
    Then it is not a region mismatch

  Scenario: Spelling variants of a municipality locality are folded together
    Given a listing with district "Sângera"
    When I check the region
    Then it is not a region mismatch

  Scenario: A null district is not a region mismatch
    Given a listing with no district
    When I check the region
    Then it is not a region mismatch

  # ── Combined classification (src/lib/listing-classification.ts: classifyListing) ──

  Scenario: A description-only duplex on a house title flags a type mismatch
    Given a listing titled "Casă, 200 m², Chișinău" with description "Casă tip duplex"
    When I classify it
    Then it has a type mismatch
    And it does not have a region mismatch
    And the reasons include "type: duplex"

  Scenario: An out-of-region plain house flags only a region mismatch
    Given a listing titled "Casă, 120 m²" with district "Ialoveni"
    When I classify it
    Then it does not have a type mismatch
    And it has a region mismatch
    And the reasons include "region: Ialoveni"

  Scenario: A clean municipality house has no flags
    Given a listing titled "Casă, 90 m², Durlești" with district "Durlești"
    When I classify it
    Then it has no flags

  # ── UI surfacing (web Listings page) ──

  Scenario: A flagged listing shows mislabel badges in the listings view
    Given a listing flagged as a Duplex in district "Ialoveni"
    When I view the Listings page
    Then I see a "Duplex" badge
    And I see an "Out-of-region" badge

  Scenario: The Hide-mislabeled toggle hides flagged listings
    Given one clean listing and one flagged listing
    And the "Hide mislabeled" toggle is off by default
    When I turn the "Hide mislabeled" toggle on
    Then the flagged listing is hidden
    And the clean listing remains visible

Feature: HTML/GraphQL parsing into Listings
  As the house-track crawler system
  I want to transform raw 999.md GraphQL responses into normalized Listing objects
  So that the dataset captures clean, validated property metadata for analysis.

  Background:
    Given the 999.md GraphQL endpoint is "https://999.md/graphql"
    And the listing URL base is "https://999.md/ro/"
    And the filter anchors are verified (subCategoryId 1406, region feature 7 optionId 12900, sale feature 1 optionId 776)
    And a 250,000 EUR price cap exists only in the SEARCH FILTER config (config.ts, filterId 9441) — the PARSERS never cap or reject prices
    And timezone is Europe/Chisinau (docker-compose TZ env var) for parseRoDate, but listing-text histograms use UTC

  ## Index Parsing (SearchAds → ListingStub[])

  Scenario: Parse SearchAds response into ListingStub array
    Given a SearchAds GraphQL response with 5 listings
    When parseIndex(json) is called
    Then the result is a ListingStub[] with length 5
    And each stub has id, url, title, priceEur, priceRaw, areaSqm, postedAt=null, imageUrls

  Scenario: Normalize EUR prices from SearchAds
    Given a listing with price {value: 150000, unit: "UNIT_EUR"}
    When parseIndex() extracts the stub
    Then priceEur equals 150000
    And priceRaw equals "150000 EUR"

  Scenario: Handle non-EUR currencies in price
    Given a listing with price {value: 3000000, unit: "UNIT_MDL"}
    When parseIndex() extracts the stub
    Then priceEur is null
    And priceRaw equals "3000000 MDL"

  Scenario: Handle missing price in SearchAds
    Given a listing with no price field or price.value.value is null
    When parseIndex() extracts the stub
    Then priceEur is null
    And priceRaw is null

  Scenario: Price value present but non-numeric short-circuits to null
    Given a listing with price {value: {value: "150000", unit: "UNIT_EUR"}} (string value)
    When parseIndex() extracts the stub
    Then priceEur is null
    And priceRaw is null

  Scenario: Price present with no unit yields a question-mark sentinel in priceRaw
    Given a listing with price {value: {value: 150000}} (no unit or measurement)
    When parseIndex() extracts the stub
    Then priceEur is null
    And priceRaw equals "150000 ?"

  Scenario: Fall back to measurement when unit is absent
    Given a listing with price {value: {value: 150000, measurement: "UNIT_EUR"}}
    When parseIndex() extracts the stub
    Then priceEur equals 150000
    And priceRaw equals "150000 EUR"

  Scenario: imageUrls defaults to empty array when images field missing
    Given a listing with no images field
    When parseIndex() extracts the stub
    Then imageUrls equals []

  Scenario: Extract area from title regex in SearchAds
    Given a listing with title "Casă, 140 m², Chișinău"
    When parseIndex() extracts the stub
    Then areaSqm equals 140

  Scenario: Return null areaSqm when title has no m² pattern
    Given a listing with title "Casă în Chișinău, superb locație"
    When parseIndex() extracts the stub
    Then areaSqm is null

  Scenario: Collect image filenames from SearchAds
    Given a listing with images {value: ["d870a.jpg", "d870b.jpg"]}
    When parseIndex() extracts the stub
    Then imageUrls equals ["d870a.jpg", "d870b.jpg"]

  Scenario: Construct correct listing URLs
    Given a listing with id "12345678"
    When parseIndex() extracts the stub
    Then url equals "https://999.md/ro/12345678"

  Scenario: Throw when SearchAds response lacks ads array
    Given a malformed SearchAds response with missing data.searchAds.ads
    When parseIndex(json) is called
    Then it throws Error with message containing "missing data.searchAds.ads"

  Scenario: Throw when ads is null instead of array
    Given a SearchAds response with ads: null
    When parseIndex(json) is called
    Then it throws Error with message containing "not an array"

  ## Detail Parsing (GetAdvert → ParsedDetail)

  Scenario: Parse GetAdvert response into ParsedDetail
    Given a GetAdvert GraphQL response for listing "12345678"
    When parseDetail("12345678", json) is called
    Then the result is a ParsedDetail with id, url, title, all scalar fields, geo, author, rawHtmlHash, filterValues

  Scenario: Normalize EUR price from GetAdvert
    Given an advert with price {value: 150000, unit: "UNIT_EUR"}
    When parseDetail() extracts price fields
    Then priceEur equals 150000
    And priceRaw equals "150000 EUR"

  Scenario: Handle unknown price currency in GetAdvert
    Given an advert with price {value: 250, unit: "UNIT_GBP"}
    When parseDetail() extracts price fields
    Then priceEur is null
    And priceRaw equals "250 GBP"

  Scenario: Extract district from city.value.translated
    Given an advert with city {value: {translated: "Chișinău"}}
    When parseDetail() extracts the detail
    Then district equals "Chișinău"

  Scenario: Extract zone (intra-city) from feature 9
    Given an advert with zone {value: {translated: "Rîșcani"}}
    When parseDetail() extracts the detail
    Then zone equals "Rîșcani"

  Scenario: Zone is null when unset
    Given an advert with no zone field
    When parseDetail() extracts the detail
    Then zone is null

  Scenario: Extract street address
    Given an advert with street {value: "Strada Marelui Voievod"}
    When parseDetail() extracts the detail
    Then street equals "Strada Marelui Voievod"

  Scenario: Extract and map floors from option enum
    Given an advert with floors {value: {value: 1643}} (option for 2 floors)
    When parseDetail() extracts the detail
    Then floors equals 2

  Scenario: Map all known floor options correctly
    Given floor option mappings 1641→1, 1643→2, 1644→3, 1652→4
    When parseDetail() processes each option
    Then each floor count is correct
    And unknown option IDs return null

  Scenario: Extract land area from feature 245
    Given an advert with landArea {value: 80} (in ares)
    When parseDetail() extracts the detail
    Then landAre equals 80

  Scenario: Land area is null when missing or non-numeric
    Given an advert with landArea {value: "unknown"}
    When parseDetail() extracts the detail
    Then landAre is null

  Scenario: Land area tolerates wrapped {value: {value: n}} shape
    Given an advert with landArea {value: {value: 80}}
    When parseDetail() extracts the detail
    Then landAre equals 80

  Scenario: Title defaults to empty string when missing
    Given an advert with no title field
    When parseDetail() extracts the detail
    Then title equals "" (empty string, not null)
    And areaSqm is null (regex over empty string)

  Scenario: Extract description from body.value.ro
    Given an advert with body {value: {ro: "Casă frumoasă cu grădină…", ru: "Красивый дом…"}}
    When parseDetail() extracts the detail
    Then description equals "Casă frumoasă cu grădină…"
    And Russian text is ignored

  Scenario: Parse Romanian posted date
    Given an advert with posted: "26 apr. 2026, 18:34"
    When parseDetail() parses the date
    Then postedAt is a Date in local TZ with day=26, month=April, year=2026, hour=18, min=34

  Scenario: Return null postedAt on unparseable date string
    Given an advert with posted: "invalid date format"
    When parseDetail() parses the date
    Then postedAt is null

  Scenario: Parse Romanian date with the period after the month omitted
    Given an advert with posted: "26 apr 2026, 18:34" (no period after "apr")
    When parseDetail() parses the date
    Then postedAt is a Date with day=26, month=April, year=2026, hour=18, min=34

  Scenario: Return null when the month abbreviation is not in the lexicon
    Given an advert with posted: "26 xyz. 2026, 18:34" (regex matches but "xyz" is unknown)
    When parseDetail() parses the date
    Then postedAt is null

  Scenario: Return null when the date has leading or trailing text
    Given an advert with posted: "posted on 26 apr. 2026, 18:34 (updated)"
    When parseDetail() parses the date
    Then postedAt is null (regex is anchored ^...$)

  Scenario: Parse Romanian bumped (reseted) date
    Given an advert with reseted: "28 apr. 2026, 10:15"
    When parseDetail() parses the date
    Then bumpedAt is a Date matching the input
    And bumpedAt is null if reseted field missing

  Scenario: Extract geo from mapPoint with defensive key lookup
    Given an advert with mapPoint {value: {lat: 47.123, lon: 28.456}}
    When parseDetail() extracts geo
    Then lat equals 47.123
    And lon equals 28.456

  Scenario: Fall back to alternative geo key names
    Given an advert with mapPoint {value: {latitude: 47.123, longitude: 28.456}}
    When parseDetail() extracts geo
    Then lat equals 47.123
    And lon equals 28.456

  Scenario: Fall back to x/y geo keys
    Given an advert with mapPoint {value: {x: 28.456, y: 47.123}}
    When parseDetail() extracts geo
    Then lat equals 47.123
    And lon equals 28.456

  Scenario: Accept the Google-Maps "lng" key for longitude
    Given an advert with mapPoint {value: {lat: 47.123, lng: 28.456}}
    When parseDetail() extracts geo
    Then lat equals 47.123
    And lon equals 28.456

  Scenario: Resolve lat and lon independently
    Given an advert with mapPoint {value: {lat: 47.123, longitude: "oops"}}
    When parseDetail() extracts geo
    Then lat equals 47.123
    And lon is null

  Scenario: Return null geo when mapPoint.value is not an object
    Given an advert with mapPoint {value: "47.1,28.4"} (a string)
    When parseDetail() extracts geo
    Then lat is null
    And lon is null

  Scenario: Return null geo on non-finite values
    Given an advert with mapPoint {value: {lat: NaN, lon: Infinity}}
    When parseDetail() extracts geo
    Then lat is null
    And lon is null

  Scenario: Return null geo when mapPoint missing
    Given an advert with no mapPoint field
    When parseDetail() extracts geo
    Then lat is null
    And lon is null

  Scenario: Extract author from owner Account
    Given an advert with owner {id: 54321, login: "seller_name", business: {plan: "premium"}}
    When parseDetail() extracts author
    Then authorId equals "54321"
    And authorName equals "seller_name"
    And authorType equals "agency"

  Scenario: Infer private seller when business plan is null
    Given an advert with owner {id: 54321, login: "seller_name", business: null}
    When parseDetail() extracts author
    Then authorType equals "private"

  Scenario: Return null author fields when owner missing
    Given an advert with no owner field
    When parseDetail() extracts author
    Then authorId is null
    And authorName is null
    And authorType is null

  Scenario: Compute stable hash for snapshot change detection
    Given an advert with title, state, price, street, description
    When parseDetail() computes rawHtmlHash
    Then rawHtmlHash is a sha256 hex string (64 characters)
    And hash is stable across bumps (reseted change does not change hash)
    And hash differs when price or description changes

  Scenario: Hash includes null values consistently
    Given two adverts that differ only in a null vs empty-string field
    When parseDetail() computes hashes
    Then the hashes differ (nulls are part of the hash)

  Scenario: Hash uses the RAW (unstripped) price unit
    Given advert A with price unit "UNIT_EUR" and advert B identical but unit "EUR"
    When parseDetail() computes hashes
    Then the hashes differ (hashStableFields does not strip the UNIT_ prefix, unlike priceRaw)

  Scenario: Missing title hashes as null but outputs as empty string
    Given an advert with no title field
    When parseDetail() computes the detail
    Then title output equals "" (empty string)
    And the hash input coerces the missing title to null (not "")

  Scenario: Hash changes when the unit string alone changes
    Given two adverts with identical value 150000 but units "UNIT_EUR" vs "UNIT_USD"
    When parseDetail() computes hashes
    Then the hashes differ

  Scenario: Extract filter values from ad-level features
    Given an advert with multiple FeatureValue entries (id, type, value)
    When parseDetail() extracts filter values
    Then each valid feature maps to a FilterValueTriple
    And filterId is 0 (placeholder for persistence layer)
    And featureId, optionId|textValue|numericValue are populated per type

  Scenario: Skip non-filter feature types
    Given an advert with FEATURE_BODY, FEATURE_IMAGES, FEATURE_MAP_POINT
    When parseDetail() extracts filter values
    Then these features are skipped
    And no FilterValueTriple is emitted for them

  Scenario: Map FEATURE_OPTIONS to optionId
    Given a feature {id: 249, type: "FEATURE_OPTIONS", value: {value: 1643}}
    When parseDetail() extracts the filter value
    Then optionId equals 1643
    And textValue and numericValue are null

  Scenario: Map FEATURE_TEXT to textValue
    Given a feature {id: 10, type: "FEATURE_TEXT", value: "Some text"}
    When parseDetail() extracts the filter value
    Then textValue equals "Some text"
    And optionId and numericValue are null

  Scenario: Map FEATURE_INT to numericValue
    Given a feature {id: 245, type: "FEATURE_INT", value: 80}
    When parseDetail() extracts the filter value
    Then numericValue equals 80
    And optionId and textValue are null

  Scenario: Map FEATURE_PRICE to numericValue
    Given a feature {id: 2, type: "FEATURE_PRICE", value: {value: 150000}}
    When parseDetail() extracts the filter value
    Then numericValue equals 150000
    And optionId is null (prices go to numericValue, not optionId)

  Scenario: FEATURE_PRICE always appears in filterValues, duplicating the scalar price
    Given an advert whose price feature (id 2) is FEATURE_PRICE value {value: 150000}
    When parseDetail() extracts the detail
    Then priceEur equals 150000 (scalar field)
    And filterValues contains a triple {featureId: 2, numericValue: 150000}
    And the duplication is intentional; persistence de-dups

  Scenario: Scalar location/floor features are also re-emitted as filter triples
    Given an advert with zone (id 9), floors (id 249), street (id 10), landArea (id 245) features
    When parseDetail() extracts the detail
    Then zone, floors, street, landAre are populated as scalar fields
    And the same featureIds also appear as triples in filterValues

  Scenario: Skip a FeatureValue whose value shape is unrecognized
    Given a feature {id: 50, type: "FEATURE_OPTIONS", value: {value: {nested: 1}}} (inner value not a number)
    When parseDetail() extracts filter values
    Then no triple is emitted for featureId 50

  Scenario: Skip keys that are not FeatureValue-shaped
    Given an advert key like autoRepublish, moderation, package, or subCategory (no numeric id + FEATURE_ type)
    When parseDetail() extracts filter values
    Then those keys produce no triples

  Scenario: Throw AdvertNotFoundError when advert is null
    Given a GetAdvert response with data.advert = null
    When parseDetail("12345678", json) is called
    Then it throws AdvertNotFoundError with id "12345678"
    And the error message is "Advert 12345678 not found (…)"

  Scenario: Throw Error when response lacks data.advert key
    Given a malformed GetAdvert response missing the data.advert key
    When parseDetail(id, json) is called
    Then it throws Error with message containing "missing data.advert key"

  ## Taxonomy Parsing (filter-taxonomy GraphQL → TaxonomyLut)

  Scenario: Bootstrap taxonomy LUT from config anchors
    Given FILTER.searchInput.filters with featureIds and filterIds
    When bootstrapLutFromConfig() is called
    Then the LUT maps each featureId to its filterId
    And the LUT is a ReadonlyMap<number, number>

  Scenario: Parse captured filter-taxonomy GraphQL response
    Given a filter-taxonomy response with {filterId, features[{featureId}]}
    When parseTaxonomyResponse(json) is called
    Then the LUT walks the tree and extracts (featureId → filterId) pairs
    And the LUT is populated and returned

  Scenario: Merge bootstrap and captured taxonomies
    Given bootstrap LUT with {featureId1: filterId1}
    And captured LUT with {featureId2: filterId2, featureId1: filterId1_new}
    When mergeLuts(bootstrap, captured) is called
    Then the result maps featureId1 to filterId1_new (captured wins)
    And featureId2 maps to filterId2 (from captured)

  Scenario: Fallback to bootstrap when taxonomy capture is stale
    Given no captured taxonomy available
    When sweep starts and resolves featureId → filterId
    Then bootstrapLutFromConfig() anchors (featureId 1, 7) are used
    And persistence layer falls back gracefully

  Scenario: Taxonomy parser uses "id" as a fallback for both filterId and featureId
    Given a taxonomy node {id: 32, features: [{id: 245}]} (no filterId/featureId keys)
    When parseTaxonomyResponse(json) is called
    Then the LUT maps 245 → 32

  Scenario: Taxonomy parser returns an empty map on garbage input
    Given a response that is null, a primitive, or an object with no filter/features structure
    When parseTaxonomyResponse(json) is called
    Then it returns an empty ReadonlyMap (does not throw)

  Scenario: Taxonomy parser skips non-finite feature ids
    Given a node {filterId: 32, features: [{featureId: NaN}, {featureId: 245}]}
    When parseTaxonomyResponse(json) is called
    Then only 245 → 32 is emitted

  Scenario: mergeLuts does not mutate its inputs
    Given two LUTs a and b
    When mergeLuts(a, b) is called
    Then a new map is returned
    And neither a nor b is modified

  ## GraphQL Operations & Variable Builders (graphql.ts)

  Scenario: buildSearchVariables injects sort and pagination
    Given pageIdx 2 and no override
    When buildSearchVariables(2) is called
    Then input.sort equals "SORT_ADS_DATE_DESC"
    And input.pagination.limit equals FILTER.pageSize
    And input.pagination.skip equals 2 * FILTER.pageSize
    And the rest of FILTER.searchInput is spread into input

  Scenario: buildSearchVariables honors an override base
    Given a SearchInputOverride with a custom subCategoryId and filters
    When buildSearchVariables(0, override) is called
    Then the override (not FILTER.searchInput) is used as the base
    And sort + pagination are still applied

  Scenario: buildAdvertVariables wraps the id
    Given listing id "12345678"
    When buildAdvertVariables("12345678") is called
    Then it returns {input: {id: "12345678"}}

  Scenario: Only the taxonomy query is a placeholder
    Given the exported query strings
    Then SEARCH_ADS_QUERY and GET_ADVERT_QUERY are live-captured operation strings
    And FILTER_TAXONOMY_QUERY is a REPLACE-ME placeholder pending live capture

  Scenario: GET_ADVERT_QUERY selects more features than parseDetail reads as scalars
    Given GET_ADVERT_QUERY selects region 7, city 8, zone 9, street 10, offerType 1, pricePerMeter 1385, oldPrice 1640
    When parseDetail processes the response
    Then only a subset become scalar fields
    And the remainder surface only through filterValues

  ## Text Mining (lib/listing-text.ts)

  Scenario: normalizeText strips diacritics and lowercases, preserving Cyrillic
    Given the text "Preț REDUS, срочно"
    When normalizeText is applied
    Then it equals "pret redus, срочно"

  Scenario: scanDistress detects distinct categories sorted
    Given a description "Urgent! Preț redus, accept schimb"
    When scanDistress(description) is called
    Then signals equals ["exchange", "reduced", "urgency"] (sorted)
    And score equals 3
    And distressed is true

  Scenario: scanDistress matches across Romanian and Russian
    Given a description "торг, рассрочка"
    When scanDistress(description) is called
    Then signals include "negotiable" and "installments"

  Scenario: scanDistress on null or empty returns the empty result
    Given a null description
    When scanDistress(null) is called
    Then signals equals []
    And score equals 0
    And distressed is false

  Scenario: photoQuality buckets by count
    Given image counts 0, 2, 7, and 12
    When photoQuality is applied to each
    Then results are "none", "sparse", "ok", "rich" respectively

  Scenario: bumpRegularity needs at least 3 timestamps
    Given only two bump timestamps
    When bumpRegularity is called
    Then it returns null

  Scenario: bumpRegularity returns 1 for perfectly regular bumps
    Given three timestamps spaced exactly one day apart
    When bumpRegularity is called
    Then it returns 1 (CV = 0)

  Scenario: bumpRegularity returns null when mean interval is non-positive
    Given three identical timestamps (all intervals 0, mean 0)
    When bumpRegularity is called
    Then it returns null

  Scenario: isWeekend and postingHourHistogram use UTC
    Given dates evaluated for weekend membership and hour bucketing
    When isWeekend and postingHourHistogram are called
    Then they use getUTCDay / getUTCHours (NOT local Europe/Chisinau time)
    And postingHourHistogram returns a 24-length array indexed by UTC hour

  ## CDN Image URLs (lib/image-url.ts)

  Scenario: thumbUrl builds a Simpals CDN URL from a bare filename
    Given filename "d870a.jpg"
    When thumbUrl("d870a.jpg") is called
    Then it equals "https://i.simpalsmedia.com/999.md/BoardImages/320x240/d870a.jpg"

  Scenario: thumbUrl passes through an already-absolute URL
    Given an absolute "https://example.com/x.jpg"
    When thumbUrl is called
    Then it returns the input unchanged

  Scenario: thumbUrl returns null for empty input
    Given null, undefined, or ""
    When thumbUrl is called
    Then it returns null

  Scenario: primaryThumb returns the first thumbnail or null
    Given imageUrls ["d870a.jpg", "d870b.jpg"]
    When primaryThumb is called
    Then it returns the thumbUrl of "d870a.jpg"

  Scenario: primaryThumb returns null on empty or non-string-first
    Given [] or [123] (first element not a string) or a non-array
    When primaryThumb is called
    Then it returns null

  ## Integration: Round-trip Parsing

  Scenario: Index and detail parse fields consistently
    Given a listing in SearchAds index response
    And the same listing in GetAdvert detail response
    When both parseIndex and parseDetail extract their fields
    Then id, url, title, price, area fields match between stub and detail
    And detail adds extra fields (description, geo, author, filters)

  Scenario: Per-listing parse error does not abort the sweep
    Given an index with 10 listings
    And one detail fetch returns AdvertNotFoundError
    When the sweep processes all listings
    Then the error is logged to SweepRun.errors
    And the other 9 listings are processed normally
    And the sweep completes with status "partial" or "ok"

  Scenario: Schema drift detection and partial capture
    Given an advert with missing or unexpected feature structure
    When parseDetail() encounters the variance
    Then it returns null for that field (not crash)
    And the partial detail is still persisted with populated fields
    And the issue is logged for manual review

  ## Acceptance Criteria

  Scenario: All parsing functions handle empty/null gracefully
    Given various edge cases (empty arrays, null values, missing keys)
    When parsers process them
    Then no unhandled exceptions are thrown
    And null fields are returned consistently
    And incomplete listings are stored with available data

  Scenario: Hash stability: same listing, bumped only
    Given a detail fetch of listing A on day 1
    When the same listing A is fetched on day 2 with only reseted changed
    Then the rawHtmlHash is identical
    And persistence layer skips snapshot creation (duplicate hash)

  Scenario: Hash changes: price or content changed
    Given a detail fetch of listing A with price P1 and description D1
    When listing A is refetched with price P2 (or description D2)
    Then the rawHtmlHash differs
    And persistence layer creates a new snapshot

  Scenario: Filter values resolve to correct filterId via taxonomy LUT
    Given a detail with featureId 245 (land area)
    And a taxonomy LUT mapping 245 → 32 (property facts)
    When persistence layer resolves filterValues
    Then filterId is set to 32 (from the LUT)

  Scenario: CDN image URLs are bare filenames at parse time
    Given index/detail responses with images.value[…] (filenames)
    When parseIndex or parseDetail extracts imageUrls
    Then imageUrls are stored as bare filenames (e.g., "d870a.jpg")
    And URL formatting (thumbUrl) happens at read/display time

Feature: MCP run_sql — open-ended "ask the data"
  As an operator exploring the crawl DB through Claude Desktop
  I want a guarded read-only SQL tool plus a schema resource
  So that I can ask arbitrary analytical questions without hand-coding a report,
  while writes and runaway queries stay impossible.

  # --- Validator (pure, unit) ---

  Scenario: Accept a plain SELECT
    Given the SQL "SELECT 1"
    When I validate it
    Then it is accepted
    And the wrapped form selects from a subquery with LIMIT 500

  Scenario: Accept a WITH (CTE) query
    Given the SQL "WITH t AS (SELECT 1 AS n) SELECT n FROM t"
    When I validate it
    Then it is accepted

  Scenario: Reject a non-SELECT statement
    Given the SQL "UPDATE \"Listing\" SET active = false"
    When I validate it
    Then it is rejected with a reason mentioning SELECT

  Scenario: Reject multiple statements
    Given the SQL "SELECT 1; DROP TABLE \"Listing\""
    When I validate it
    Then it is rejected as multi-statement

  Scenario: Reject DROP hidden inside a comment-and-literal decoy
    Given the SQL "SELECT '; DROP TABLE x' /* ; still one statement */"
    When I validate it
    Then it is accepted as a single statement

  Scenario: Reject empty input
    Given the SQL ""
    When I validate it
    Then it is rejected

  Scenario: Strip a trailing semicolon before wrapping
    Given the SQL "SELECT 1;"
    When I validate it
    Then it is accepted
    And the wrapped form does not break on the trailing semicolon

  # --- Serialization (unit) ---

  Scenario: Serialize BigInt values without throwing
    Given a result row containing a BigInt count
    When I serialize the rows
    Then serialization succeeds and the count is a string

  Scenario: Cap an oversized payload
    Given more result bytes than the 100 KB cap
    When I serialize the rows
    Then trailing rows are dropped and truncated is true

  # --- Execution against the read-only role (integration) ---

  Scenario: Run an aggregate query and get rows back
    Given seeded listings across districts with a current-price snapshot
    When I run "SELECT district, avg(\"priceEur\") FROM \"Listing\" GROUP BY district"
    Then I get one row per district

  Scenario: count(*) comes back usable
    Given seeded listings
    When I run "SELECT count(*) AS c FROM \"Listing\""
    Then the count equals the number of seeded listings

  Scenario: The read-only role blocks data-modifying CTEs
    Given seeded listings
    When I run "WITH x AS (INSERT INTO \"Listing\"(id,url,title,\"lastSeenAt\",\"lastFetchedAt\") VALUES ('hack','u','t',now(),now()) RETURNING id) SELECT * FROM x"
    Then the query is rejected by the database and no row is inserted

  Scenario: statement_timeout kills a runaway query
    Given a short statement timeout
    When I run a query that sleeps longer than the timeout
    Then the query is aborted

  Scenario: run_sql is unconfigured when DATABASE_URL_RO is absent
    Given no DATABASE_URL_RO
    When I construct the runner and run any query
    Then it reports "not configured"

  # --- Caching (integration) ---

  Scenario: Identical query is served from cache without re-querying
    Given a query that has been run once
    When I run the identical query again
    Then the data query is not re-executed and cached is true

  Scenario: A new completed sweep busts the cache
    Given a cached query result
    When a new SweepRun finishes
    And I run the identical query again
    Then the cache misses and the data query runs again

  Scenario: Failed queries are not cached
    Given a query that errors
    When I run it twice
    Then nothing is served from cache

  # --- Schema resource (unit) ---

  Scenario: Schema resource includes every model and a preamble
    When I load the schema resource text
    Then it contains each model name from prisma/schema.prisma
    And it contains the timezone preamble

  Scenario: Schema resource is read from disk only once
    When I load the schema resource text twice
    Then the file is read a single time

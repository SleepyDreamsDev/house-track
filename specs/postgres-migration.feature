Feature: Postgres migration with testcontainer-backed test infra
  As the operator of house-track
  I want the persistence layer running on Postgres with native JSON columns
  So that downstream slices (Setting/Source tables, Grafana datasource, HTTP API)
  can rely on a real RDBMS without a separate SQLite-only test harness.

  Background:
    Given Prisma's datasource provider is "postgresql"
    And the Listing.features, Listing.imageUrls, and SweepRun.errors columns are typed as Json
    And the existing `0_init` SQLite migration has been replaced with a Postgres `0_init`
    And tests bootstrap a per-Vitest-process Postgres testcontainer

  Scenario: persistDetail round-trips features as a Json array
    Given a parsed detail with features ["garage", "garden"] and imageUrls ["https://cdn.999.md/a.jpg"]
    When persistDetail runs against Postgres
    Then the Listing.features column contains the array ["garage", "garden"] as JSON
    And the Listing.imageUrls column contains the array ["https://cdn.999.md/a.jpg"] as JSON
    And no JSON.stringify call is required at the persistence boundary

  Scenario: finishSweep round-trips errors as a Json array
    Given a sweep that recorded one error {url, status, msg}
    When finishSweep runs against Postgres
    Then the SweepRun.errors column contains the array of error objects as JSON
    And finishSweep with zero errors stores null in errors

  Scenario: get_listing reads Json imageUrls without parseImageUrls fallback
    Given a Listing row with imageUrls stored as a Json array
    When the MCP get_listing query reads the row
    Then the returned imageUrls is the parsed array
    And no JSON.parse is required at the read boundary

  Scenario: All 146 existing tests pass against testcontainer Postgres
    Given the existing Vitest suite
    When `pnpm test` runs against the testcontainer
    Then every previously-passing test still passes
    And no test references "file:" SQLite URLs anymore

  Scenario: Each test file owns an isolated database
    Given two test files run concurrently in the Vitest process
    When each calls beforeAll
    Then each receives a unique CREATE-DATABASE'd Postgres database
    And one test file's writes are not visible to the other

  Scenario: docker-compose brings up postgres healthy before crawler
    Given docker-compose.yml declares a postgres service with healthcheck pg_isready
    And the crawler service depends_on postgres with condition: service_healthy
    When `docker compose up` starts both services
    Then crawler waits for postgres to be healthy
    And crawler runs `prisma migrate deploy` before booting node
    And crawler binds DATABASE_URL to the postgres service

  Scenario: Postgres port is bound to localhost only
    Given the docker-compose postgres service
    Then its port mapping is "127.0.0.1:5432:5432"
    And no public binding (0.0.0.0) is permitted

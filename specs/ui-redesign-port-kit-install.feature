Feature: UI redesign port-kit install (Phase 0)
  As an operator
  I want the redesigned operator UI installed end-to-end against stub backends
  So that every page renders without 500s and the new SweepDetail route is reachable
  Before the real backend wiring lands in subsequent phases

  Scenario: Frontend kit files replace existing pages
    Given the port-kit/web tree contains the redesigned pages and shared UI primitives
    When I copy port-kit/web/src into web/src and port-kit/web/tailwind.config.ts into web/
    Then web/src/pages/{Dashboard,Listings,Sweeps,Settings}.tsx come from the kit
    And web/src/pages/SweepDetail.tsx exists
    And web/src/components/ui/{KStat,PageHeader,PhotoPlaceholder,Sparkline,StatusDot,Toggle}.tsx exist
    And web/src/lib/{format,sse}.ts exist
    And web/src/router.tsx registers a route for /sweeps/:id

  Scenario: Backend route stubs land at the project's path conventions
    Given the port-kit/server tree contains stub routers for sweep detail/stream/stats/listings-feed
    When I copy them into src/web with src/web/events.ts and src/web/routes/{sweeps.detail,sweeps.stream,stats,listings.feed}.ts
    Then src/web/server.ts mounts each router under /api
    And the new routes do not collide with /api/sweeps/:id/errors or any existing route

  Scenario: Prisma SweepRun gains four nullable JSON columns
    Given prisma/schema.prisma defines SweepRun without configSnapshot/pagesDetail/detailsDetail/eventLog
    When I add the four nullable Json fields and run prisma generate
    Then the schema validates and the generated client exposes the new fields
    And a fresh prisma migration directory contains the additive ALTER TABLE statements

  Scenario: Stub endpoints return shapes the redesigned pages consume
    Given the new routers are mounted on the Hono app
    When I GET /api/sweeps/<id>, /api/sweeps/<id>/stream, /api/stats/by-district, /api/stats/new-per-day, /api/listings/new-today, /api/listings/price-drops
    Then each responds 200 with the shape the matching React page expects
    And /api/sweeps/<id>/stream responds with Content-Type text/event-stream

  Scenario: Backend smoke test still passes against the existing API surface
    Given the server.test.ts integration suite covers /api/sweeps, /api/listings, /api/settings, /api/sources, /api/circuit
    When I run pnpm test
    Then every existing assertion still passes (no breaking response shape changes)

  Scenario: Frontend tests are updated to match the redesigned pages
    Given the previous frontend tests asserted strings like "Listings", "Reset Circuit Breaker", "Crawler Tuning"
    When the new pages render strings like "Houses", "Reset breaker", "Politeness"
    Then web/src/__tests__/{Dashboard,Listings,Sweeps,Settings}.test.tsx assertions match the redesigned UI
    And pnpm -C web test passes

  Scenario: port-kit directory is removed after install verification
    Given the kit has been copied and the build verified
    When I delete port-kit/
    Then no residual port-kit/ files remain in the working tree
    And nothing in src/ or web/ imports from port-kit/

  Scenario: Phase 0 leaves SSE id mismatch and frontend missing endpoints documented for follow-ups
    Given Phase 0 only installs the kit and routes its stubs
    When I read the plan's backlog section
    Then it records POST /api/sweeps, cancel, source/trigger/durationMs columns, and the listings envelope as deferred
    And no Phase 0 work depends on those follow-ups

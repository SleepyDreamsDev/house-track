Feature: Co-locate crawler and web API
  As a developer
  I want the crawler and web API to run in the same process
  So that in-process EventEmitter can connect SSE bridge to active sweeps

  Scenario: API starts alongside cron scheduler
    Given src/index.ts has bootstrap() scheduling cron
    When the process starts
    Then Hono API is listening on port 3000
    And cron scheduler is still running
    And /api/health returns 200

  Scenario: Docker Compose exposes API port to host
    Given property-crawler service runs in Docker
    When docker-compose.yml has port mapping 127.0.0.1:3000:3000
    Then curl localhost:3000/api/health succeeds from host
    And Vite dev proxy can reach the API

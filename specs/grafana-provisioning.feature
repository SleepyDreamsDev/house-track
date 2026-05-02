Feature: Grafana provisioning and dashboard embed
  As an operator
  I want Grafana to be auto-provisioned with Postgres datasource and dashboards
  So that I can view analytics without manual Grafana setup

  Scenario: Grafana service exists in docker-compose
    Given docker-compose.yml is configured
    When I inspect the services
    Then the grafana service is present
    And grafana listens on 127.0.0.1:3001
    And GF_AUTH_ANONYMOUS_ENABLED is true
    And GF_SECURITY_ALLOW_EMBEDDING is true

  Scenario: Postgres datasource is provisioned
    Given grafana/provisioning/datasources/ directory exists
    When provisioning loads
    Then postgres.yaml exists and is valid YAML
    And it defines a Postgres datasource pointing to postgres:5432
    And the database name is house_track

  Scenario: Dashboards are auto-loaded
    Given grafana/provisioning/dashboards/ directory exists
    When provisioning loads
    Then dashboards.yaml exists and is valid YAML
    And it configures dashboard auto-load from the same directory

  Scenario: Operator overview dashboard exists
    Given grafana/provisioning/dashboards/ directory exists
    When I inspect the dashboard files
    Then operator-overview.json exists and is valid JSON
    And it has panels for Sweeps timeline, Listings per day, Politeness pulse, Circuit state
    And it references the postgres datasource

  Scenario: Dashboard iframe is embedded in web UI
    Given web/src/pages/Dashboard.tsx exists
    When the page renders the Grafana dashboard section
    Then an iframe element exists
    And iframe src points to http://127.0.0.1:3001/d/operator-overview/operator-overview
    And iframe has kiosk=tv and theme=light query params

  Scenario: Grafana constants are defined
    Given web/src/lib/grafana.ts exists
    When it is imported
    Then GRAFANA_URL is exported
    And GRAFANA_DASHBOARD_URL is exported
    And Dashboard.tsx uses these constants

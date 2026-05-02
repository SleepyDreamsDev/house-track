import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Grafana provisioning', () => {
  const projectRoot = process.cwd();
  const grafanaDir = path.join(projectRoot, 'grafana', 'provisioning');
  const datasourcesDir = path.join(grafanaDir, 'datasources');
  const dashboardsDir = path.join(grafanaDir, 'dashboards');

  it('should have grafana/provisioning/datasources directory', () => {
    expect(fs.existsSync(datasourcesDir)).toBe(true);
  });

  it('should have grafana/provisioning/dashboards directory', () => {
    expect(fs.existsSync(dashboardsDir)).toBe(true);
  });

  it('should have postgres.yaml datasource config', () => {
    const postgresYamlPath = path.join(datasourcesDir, 'postgres.yaml');
    expect(fs.existsSync(postgresYamlPath)).toBe(true);

    const content = fs.readFileSync(postgresYamlPath, 'utf-8');
    expect(content).toContain('apiVersion');
    expect(content).toContain('datasources');
    expect(content).toContain('Postgres');
    expect(content).toContain('postgres');
    expect(content).toContain('house_track');
  });

  it('should have dashboards.yaml provisioning config', () => {
    const dashboardsYamlPath = path.join(dashboardsDir, 'dashboards.yaml');
    expect(fs.existsSync(dashboardsYamlPath)).toBe(true);

    const content = fs.readFileSync(dashboardsYamlPath, 'utf-8');
    expect(content).toContain('apiVersion');
    expect(content).toContain('providers');
    expect(content).toContain('path:');
  });

  it('should have operator-overview.json dashboard', () => {
    const dashboardJsonPath = path.join(dashboardsDir, 'operator-overview.json');
    expect(fs.existsSync(dashboardJsonPath)).toBe(true);

    const content = fs.readFileSync(dashboardJsonPath, 'utf-8');
    const dashboard = JSON.parse(content) as {
      title?: string;
      panels?: unknown[];
    };

    expect(dashboard).toBeDefined();
    expect(dashboard.title).toBe('Operator Overview');
    expect(dashboard.panels).toBeDefined();
    expect(Array.isArray(dashboard.panels)).toBe(true);
    expect(dashboard.panels?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('operator-overview dashboard should have required panels', () => {
    const dashboardJsonPath = path.join(dashboardsDir, 'operator-overview.json');
    const content = fs.readFileSync(dashboardJsonPath, 'utf-8');
    const dashboard = JSON.parse(content) as {
      panels?: Array<{ title?: string }>;
    };

    const panelTitles = (dashboard.panels ?? []).map((p) => p.title);

    expect(panelTitles.some((t) => t && t.includes('Sweep'))).toBe(true);
    expect(panelTitles.some((t) => t && t.includes('Listing'))).toBe(true);
    expect(panelTitles.some((t) => t && t.includes('Politeness'))).toBe(true);
    expect(panelTitles.some((t) => t && t.includes('Circuit'))).toBe(true);
  });

  it('operator-overview dashboard should reference postgres datasource', () => {
    const dashboardJsonPath = path.join(dashboardsDir, 'operator-overview.json');
    const content = fs.readFileSync(dashboardJsonPath, 'utf-8');
    const dashboard = JSON.parse(content);

    const dashboardText = JSON.stringify(dashboard);
    expect(dashboardText).toContain('Postgres');
  });

  it('docker-compose.yml should have grafana service', () => {
    const composePath = path.join(projectRoot, 'docker-compose.yml');
    const content = fs.readFileSync(composePath, 'utf-8');

    expect(content).toContain('grafana');
    expect(content).toContain('grafana/grafana:latest');
    expect(content).toContain('127.0.0.1:3001');
    expect(content).toContain('GF_AUTH_ANONYMOUS_ENABLED');
    expect(content).toContain('GF_SECURITY_ALLOW_EMBEDDING');
    expect(content).toContain('./grafana/provisioning:/etc/grafana/provisioning');
  });

  it('should define GRAFANA_URL constant', () => {
    const grafanaLibPath = path.join(projectRoot, 'web', 'src', 'lib', 'grafana.ts');
    expect(fs.existsSync(grafanaLibPath)).toBe(true);

    const content = fs.readFileSync(grafanaLibPath, 'utf-8');
    expect(content).toContain('GRAFANA_URL');
    expect(content).toContain('127.0.0.1:3001');
  });

  it('should define GRAFANA_DASHBOARD_URL constant', () => {
    const grafanaLibPath = path.join(projectRoot, 'web', 'src', 'lib', 'grafana.ts');
    const content = fs.readFileSync(grafanaLibPath, 'utf-8');

    expect(content).toContain('GRAFANA_DASHBOARD_URL');
    expect(content).toContain('operator-overview');
    expect(content).toContain('kiosk=tv');
    expect(content).toContain('theme=light');
  });
});

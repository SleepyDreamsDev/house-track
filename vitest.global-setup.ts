import { execa } from 'execa';
import { Client } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

export const TEMPLATE_DB = 'house_track_template';

export default async function setup(): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('postgres')
    .withUsername('test')
    .withPassword('test')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);
  const baseUrl = `postgresql://test:test@${host}:${port}`;

  process.env.PG_BASE_URL = baseUrl;

  const admin = new Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await admin.end();

  // Use `migrate deploy` (not `db push`) so tests fail fast when schema.prisma
  // has a model that no migration creates — this is the same surface the
  // Docker runtime stage uses, and `db push` would silently sync schema from
  // the model file regardless of whether a migration exists.
  await execa('pnpm', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: `${baseUrl}/${TEMPLATE_DB}` },
    stdio: 'pipe',
  });

  return async () => {
    if (container) {
      await container.stop();
      container = undefined;
    }
  };
}

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll } from 'vitest';

import { disconnectPrisma } from './src/db.js';
import { TEMPLATE_DB } from './vitest.global-setup.js';

let dbName: string | undefined;

beforeAll(async () => {
  const baseUrl = process.env.PG_BASE_URL;
  if (!baseUrl) {
    throw new Error('PG_BASE_URL not set — vitest global setup must have run first');
  }

  dbName = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

  const admin = new Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName} WITH TEMPLATE ${TEMPLATE_DB}`);
  await admin.end();

  process.env.DATABASE_URL = `${baseUrl}/${dbName}`;
});

afterAll(async () => {
  await disconnectPrisma();

  const baseUrl = process.env.PG_BASE_URL;
  if (!baseUrl || !dbName) return;

  const admin = new Client({ connectionString: `${baseUrl}/postgres` });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.end();
  dbName = undefined;
});

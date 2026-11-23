#!/usr/bin/env node
/*
 * Apply prisma/migrations/*\/migration.sql to DATABASE_URL without Prisma's
 * native schema engine (which has no Android build). Used by the Android
 * embedded server instead of `prisma migrate deploy`.
 *
 * It keeps Prisma's own bookkeeping table (_prisma_migrations) with the same
 * columns and the same checksum (sha256 of migration.sql), so a database
 * migrated by this script is recognised as up to date by `prisma migrate
 * deploy` / `prisma migrate status`, and the sync feature's schema-version
 * check (newest applied migration name) works unchanged.
 *
 * Like Prisma, each migration file is sent as one multi-statement script, and
 * a failed migration is recorded (finished_at NULL, logs) and stops the run.
 *
 * Usage: DATABASE_URL=postgres://... node prisma/apply-migrations.js [migrationsDir]
 */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum"              VARCHAR(64) NOT NULL,
    "finished_at"           TIMESTAMPTZ,
    "migration_name"        VARCHAR(255) NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        TIMESTAMPTZ,
    "started_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
)`;

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, 'migrations'));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(BOOKKEEPING);
    const { rows } = await client.query(
      'SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"',
    );
    const done = new Set(rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name));
    const failed = rows.filter((r) => !r.finished_at && !r.rolled_back_at).map((r) => r.migration_name);
    if (failed.length) {
      throw new Error(`Migration(s) previously failed and need attention: ${failed.join(', ')}`);
    }

    let applied = 0;
    for (const name of names) {
      if (done.has(name)) continue;
      const sql = fs.readFileSync(path.join(dir, name, 'migration.sql'), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const id = crypto.randomUUID();
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, applied_steps_count) VALUES ($1, $2, $3, now(), 0)',
        [id, checksum, name],
      );
      try {
        await client.query(sql); // simple query protocol: the whole file as one script
      } catch (err) {
        await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [id, String(err && err.stack || err)]);
        throw new Error(`Migration ${name} failed: ${err.message}`);
      }
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id],
      );
      applied++;
      console.log(`applied ${name}`);
    }
    console.log(`${names.length} migrations found, ${applied} applied, database is up to date.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

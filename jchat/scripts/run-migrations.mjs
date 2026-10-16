// Apply the current PostgreSQL schema to a new JobChat database.
// Migrations are recorded so repeated runs only execute new files.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = [
  { id: 'sql/010_pgvector_extension.sql', transaction: true },
  { id: 'drizzle/0000_test.sql', transaction: true },
  { id: 'sql/030_fix_missing_fts_and_indexes.sql', transaction: true },
  { id: 'sql/018_jchat_memory_rpc.sql', transaction: true },
  { id: 'sql/019_jchat_search_rpc.sql', transaction: true },
  { id: 'sql/029_notify_triggers.sql', transaction: true },
  { id: 'sql/032_drop_members_active_session.sql', transaction: true },
  { id: 'sql/032_conversation_updated_at_trigger.sql', transaction: true },
  { id: 'sql/033_one_dm_per_user.sql', transaction: false },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and configure it first.');
  process.exit(1);
}

const { Client } = await import('pg');
const client = new Client({ connectionString: databaseUrl });
await client.connect();

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS jchat_schema_migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const migration of migrations) {
    const { rowCount } = await client.query(
      'SELECT 1 FROM jchat_schema_migrations WHERE id = $1',
      [migration.id],
    );
    if (rowCount > 0) {
      console.log(`skip ${migration.id}`);
      continue;
    }

    const sql = readFileSync(join(rootDir, migration.id), 'utf8');
    console.log(`apply ${migration.id}`);
    try {
      if (migration.transaction) await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO jchat_schema_migrations (id) VALUES ($1)', [migration.id]);
      if (migration.transaction) await client.query('COMMIT');
    } catch (error) {
      if (migration.transaction) await client.query('ROLLBACK');
      throw error;
    }
  }

  console.log(`Database is ready (${migrations.length} migrations checked).`);
} catch (error) {
  console.error(`Migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

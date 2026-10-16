# PostgreSQL migrations

JobChat uses the Drizzle schema as its table baseline and a small set of SQL migrations for PostgreSQL-specific objects such as extensions, generated columns, functions, triggers, and indexes.

## Apply migrations

From the `jchat/` directory:

```bash
npm run migrate
```

The command reads `DATABASE_URL` from `jchat/.env` and records completed files in `jchat_schema_migrations`. Re-running it is safe: already recorded migrations are skipped.

The migration order is defined in `scripts/run-migrations.mjs` so that the generated full-text-search column exists before the search function is created.

## Fresh database requirements

- PostgreSQL 16 or newer
- The `pgvector` and `pg_trgm` extensions available to the database user
- Permission to create tables, functions, triggers, indexes, and extensions

The root `docker-compose.yml` uses `pgvector/pgvector:pg16` and is the easiest way to create a compatible local database.

## Migration files

| File | Purpose |
| --- | --- |
| `010_pgvector_extension.sql` | Enable vector and trigram support |
| `018_jchat_memory_rpc.sql` | Vector similarity recall function |
| `019_jchat_search_rpc.sql` | Full-text message search function |
| `029_notify_triggers.sql` | PostgreSQL `LISTEN` / `NOTIFY` change events |
| `030_fix_missing_fts_and_indexes.sql` | Generated search column and supporting indexes |
| `032_drop_members_active_session.sql` | Remove an unused legacy column from the baseline |
| `032_conversation_updated_at_trigger.sql` | Maintain conversation update timestamps |
| `033_one_dm_per_user.sql` | Prevent duplicate direct-message conversations |

The initial tables, constraints, and foreign keys are in `../drizzle/0000_test.sql`, generated from `server/sql/schema/`.

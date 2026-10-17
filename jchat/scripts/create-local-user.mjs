#!/usr/bin/env node
// Create or update a local development user without printing credentials or tokens.
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import pg from 'pg';

const username = process.env.JCHAT_LOCAL_USERNAME || 'admin';
const password = process.env.JCHAT_LOCAL_PASSWORD;
const databaseUrl = process.env.DATABASE_URL;

if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) {
  console.error('JCHAT_LOCAL_USERNAME must be 3–30 letters, digits, underscores, or hyphens.');
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error('Set JCHAT_LOCAL_PASSWORD to at least 12 characters in jchat/.env.');
  process.exit(1);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is required in jchat/.env.');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const passwordHash = await hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1,
  });
  const { rows } = await pool.query(
    `INSERT INTO local_users (username, password_hash, display_name)
     VALUES ($1, $2, $1)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           display_name = EXCLUDED.display_name
     RETURNING id, username`,
    [username, passwordHash],
  );
  console.log(`Local user ready: ${rows[0].username} (${rows[0].id})`);
} catch (error) {
  console.error(`Could not create local user: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}

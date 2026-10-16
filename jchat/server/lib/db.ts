import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../sql/schema';
import { config } from '../config';
import { logger } from '../logger';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, '[db] Unexpected pool error');
});

export const db = drizzle(pool, { schema });
export { pool };

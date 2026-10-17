import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required in jchat/.env');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/sql/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl,
  },
});

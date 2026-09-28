import pg from "pg";

const { Pool, types } = pg;

// Keep timestamptz as ISO strings; the app converts explicitly (avoids implicit local-time bugs).
types.setTypeParser(1184, (v) => v);
types.setTypeParser(1114, (v) => v);
// int8 -> number (bigserial ids are small enough)
types.setTypeParser(20, (v) => Number(v));

export function adminPool(url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error("DATABASE_URL (or DATABASE_URL_ADMIN) is not set");
  return new Pool({ connectionString: url, max: 5 });
}

/** Pool for the RLS-restricted application role. */
export function appPool(url = process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL): pg.Pool {
  if (!url) throw new Error("DATABASE_URL_APP (or DATABASE_URL) is not set");
  return new Pool({ connectionString: url, max: 10 });
}

export type { Pool } from "pg";

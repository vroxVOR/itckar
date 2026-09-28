import pg from "pg";

const { Pool, types } = pg;

// timestamptz/timestamp come back as normalised ISO-8601 UTC strings ("2026-10-05T08:00:00.000Z"),
// so they are safe to compare lexicographically and to Date.parse; the app converts explicitly.
types.setTypeParser(1184, (v) => new Date(v).toISOString());
types.setTypeParser(1114, (v) => new Date(v + "Z").toISOString());
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

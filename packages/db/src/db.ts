import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import type { Pool } from "pg";
import type { DB } from "./schema.js";

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

export function createDb(pool: Pool): Db {
  return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

/**
 * Run `fn` inside a transaction with the RLS tenant context set.
 * Every tenant-scoped query MUST go through this (or `withoutTenant` for platform tables).
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.tenant_id', ${tenantId}, true)`.execute(tx);
    return fn(tx);
  });
}

/** Explicitly-named passthrough for platform-level work (auth, jobs) with no tenant context. */
export async function withoutTenant<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.tenant_id', '', true)`.execute(tx);
    return fn(tx);
  });
}

/** Postgres tstzrange literal for a half-open interval. */
export function tstzrange(startMs: number, endMs: number): string {
  return `[${new Date(startMs).toISOString()},${new Date(endMs).toISOString()})`;
}

/** Parse a tstzrange literal "[a,b)" (as returned by pg) into epoch ms. */
export function parseTstzrange(literal: string): { start: number; end: number } {
  const m = /^[\[(]"?([^,"]+)"?,"?([^)\]"]+)"?[)\]]$/.exec(literal);
  if (!m) throw new Error(`Cannot parse tstzrange: ${literal}`);
  return { start: Date.parse(m[1]!), end: Date.parse(m[2]!) };
}

export { sql };

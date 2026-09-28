import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Applies pending SQL files from ./migrations in lexical order, one transaction each. */
export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query(
      `create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())`,
    );
    await client.query(`select pg_advisory_lock(727272)`);
    const done = new Set(
      (await client.query<{ name: string }>(`select name from schema_migration`)).rows.map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(`insert into schema_migration (name) values ($1)`, [f]);
        await client.query("commit");
        applied.push(f);
      } catch (e) {
        await client.query("rollback");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`, { cause: e });
      }
    }
    await client.query(`select pg_advisory_unlock(727272)`);
  } finally {
    client.release();
  }
  return applied;
}

/** Drops and recreates the public schema. Dev/test only. */
export async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query(`drop schema public cascade; create schema public; grant all on schema public to public;`);
}

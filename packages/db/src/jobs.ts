import { sql } from "kysely";
import type { Db, Tx } from "./db.js";
import type { Job } from "./schema.js";

export interface EnqueueInput {
  tenantId?: string | null;
  kind: string;
  payload: Record<string, unknown>;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
}

export async function enqueueJob(tx: Tx, j: EnqueueInput): Promise<number | null> {
  const r = await tx
    .insertInto("job")
    .values({
      tenant_id: j.tenantId ?? null,
      kind: j.kind,
      payload: JSON.stringify(j.payload),
      run_at: j.runAt ?? new Date(),
      dedupe_key: j.dedupeKey ?? null,
      max_attempts: j.maxAttempts ?? 5,
    })
    .onConflict((oc) => oc.doNothing())
    .returning("id")
    .executeTakeFirst();
  return r?.id ?? null;
}

export async function cancelJobsByPrefix(tx: Tx, prefix: string): Promise<void> {
  await tx
    .updateTable("job")
    .set({ status: "cancelled" })
    .where("status", "=", "pending")
    .where("dedupe_key", "like", `${prefix.replace(/[%_]/g, "\\$&")}%`)
    .execute();
}

/** Claim up to `limit` due jobs with SKIP LOCKED so multiple workers can run. */
export async function claimJobs(db: Db, workerId: string, limit = 10): Promise<Job[]> {
  return db.transaction().execute(async (tx) => {
    const due = await tx
      .selectFrom("job")
      .select("id")
      .where("status", "=", "pending")
      .where("run_at", "<=", new Date().toISOString())
      .orderBy("run_at")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    if (due.length === 0) return [];
    return tx
      .updateTable("job")
      .set({ status: "running", locked_at: new Date(), locked_by: workerId, attempts: sql`attempts + 1` })
      .where(
        "id",
        "in",
        due.map((d) => d.id),
      )
      .returningAll()
      .execute();
  });
}

export async function completeJob(db: Db, id: number): Promise<void> {
  await db.updateTable("job").set({ status: "done", locked_at: null, locked_by: null }).where("id", "=", id).execute();
}

/** Exponential backoff: 1, 2, 4, 8 ... minutes, then failed. */
export async function failJob(db: Db, job: Job, error: string): Promise<void> {
  const exhausted = job.attempts >= job.max_attempts;
  const delayMs = Math.min(60, 2 ** (job.attempts - 1)) * 60_000;
  await db
    .updateTable("job")
    .set({
      status: exhausted ? "failed" : "pending",
      run_at: exhausted ? job.run_at : new Date(Date.now() + delayMs),
      last_error: error.slice(0, 2000),
      locked_at: null,
      locked_by: null,
    })
    .where("id", "=", job.id)
    .execute();
}

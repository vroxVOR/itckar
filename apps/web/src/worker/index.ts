/**
 * itckar worker: claims due jobs from the `job` table (SKIP LOCKED) and sends notifications.
 * Run with `pnpm worker`. Multiple instances are safe.
 */
import { hostname } from "node:os";
import { appPool, claimJobs, completeJob, createDb, failJob, sql } from "@itckar/db";
import { emailProvider } from "./providers/email";
import { smsProvider } from "./providers/sms";
import { handleJob, type HandlerContext } from "./handlers";

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);
const workerId = `${hostname()}:${process.pid}`;

async function main() {
  const db = createDb(appPool());
  const ctx: HandlerContext = { db, email: emailProvider(), sms: smsProvider(), appUrl: process.env.APP_URL ?? "http://localhost:3000" };
  console.log(`[worker ${workerId}] started (email=${ctx.email.name}, sms=${ctx.sms.name})`);
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log("[worker] stopping…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  let tick = 0;
  while (!stopping) {
    try {
      const jobs = await claimJobs(db, workerId, 10);
      for (const job of jobs) {
        try {
          await handleJob(ctx, job);
          await completeJob(db, job.id);
        } catch (e) {
          console.error(`[worker] job ${job.id} (${job.kind}) failed:`, (e as Error).message);
          await failJob(db, job, (e as Error).message);
        }
      }
      if (tick++ % 12 === 0) {
        // housekeeping once a minute: expired holds
        await sql`delete from resource_block where kind = 'hold' and expires_at < now()`.execute(db);
      }
      if (jobs.length === 0) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e) {
      console.error("[worker] loop error:", (e as Error).message);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

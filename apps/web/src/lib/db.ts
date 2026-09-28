import "server-only";
import { appPool, createDb, type Db } from "@itckar/db";

declare global {
  // eslint-disable-next-line no-var
  var __itckarDb: Db | undefined;
}

/** Singleton Kysely instance on the RLS-restricted application role (survives HMR). */
export function db(): Db {
  if (!globalThis.__itckarDb) globalThis.__itckarDb = createDb(appPool());
  return globalThis.__itckarDb;
}

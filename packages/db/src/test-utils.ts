import pg from "pg";
import { createDb, type Db } from "./db";
import { migrate, resetDatabase } from "./migrate";
import { adminPool } from "./pool";

const ADMIN_URL = process.env.DATABASE_URL_TEST ?? "postgres://postgres@localhost:5432/itckar_test";

/** Fresh schema per test file; returns an admin db (migrations) and an RLS-restricted app db. */
export async function setupTestDatabase(): Promise<{ admin: Db; app: Db; close: () => Promise<void> }> {
  const adminP = adminPool(ADMIN_URL);
  await resetDatabase(adminP);
  await migrate(adminP);
  const u = new URL(ADMIN_URL);
  u.username = "itckar_app";
  u.password = "itckar_app";
  const appP = new pg.Pool({ connectionString: u.toString(), max: 20 });
  const admin = createDb(adminP);
  const app = createDb(appP);
  return {
    admin,
    app,
    close: async () => {
      await app.destroy();
      await admin.destroy();
    },
  };
}

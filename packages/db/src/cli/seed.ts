import { adminPool } from "../pool";
import { createDb } from "../db";
import { seedDemoSalon } from "../seed";

const pool = adminPool();
const db = createDb(pool);
seedDemoSalon(db)
  .then((r) => {
    console.log(`Seeded tenant ${r.tenantId} (slug salon-demo, login demo@itckar.local / demo1234)`);
    return db.destroy();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

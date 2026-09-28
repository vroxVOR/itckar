import { adminPool } from "../pool.js";
import { migrate, resetDatabase } from "../migrate.js";

const pool = adminPool();
resetDatabase(pool)
  .then(() => migrate(pool))
  .then((applied) => {
    console.log(`Reset. Applied: ${applied.join(", ")}`);
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

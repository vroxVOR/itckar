import { adminPool } from "../pool";
import { migrate, resetDatabase } from "../migrate";

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

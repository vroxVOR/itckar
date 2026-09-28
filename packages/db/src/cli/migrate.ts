import { migrate } from "../migrate.js";
import { adminPool } from "../pool.js";

const pool = adminPool(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL);
migrate(pool)
  .then((applied) => {
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date");
    return pool.end();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

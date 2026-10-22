import "./env";
import { migratePostgres } from "../src/db/client";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL is not set: nothing to migrate (the embedded dev database migrates itself).");
  process.exit(0);
}
await migratePostgres(url);
console.log("Migrations applied.");

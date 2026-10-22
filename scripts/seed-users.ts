import "./env";
import { getDb } from "../src/db/client";
import { seedUsers } from "../src/auth/users";

const raw = process.env.SEED_USERS;
if (!raw) {
  console.error('SEED_USERS is not set. Example: SEED_USERS=\'[{"email":"raghav@freshroots.example","name":"Raghav","role":"planner","password":"a-long-password"}]\'');
  process.exit(1);
}
const result = await seedUsers(await getDb(), raw);
console.log(`Users: ${result.created} created, ${result.updated} updated.`);
process.exit(0);

import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "./password";
import { ROLES } from "./roles";

export const seedUsersSchema = z
  .array(
    z.object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().min(1).max(80),
      role: z.enum(ROLES),
      password: z.string().min(10, "Passwords need at least 10 characters").max(200),
    }),
  )
  .min(1);

/** Create or update the named users. There is no sign-up page: this is the only way users appear. */
export async function seedUsers(db: Db, raw: string): Promise<{ created: number; updated: number }> {
  const list = seedUsersSchema.parse(JSON.parse(raw));
  let created = 0;
  let updated = 0;
  for (const u of list) {
    const passwordHash = await hashPassword(u.password);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, u.email)).limit(1);
    if (existing) {
      await db.update(users).set({ name: u.name, role: u.role, passwordHash, active: true }).where(eq(users.id, existing.id));
      updated += 1;
    } else {
      await db.insert(users).values({ email: u.email, name: u.name, role: u.role, passwordHash });
      created += 1;
    }
  }
  return { created, updated };
}

export async function getUser(db: Db, id: string) {
  const [u] = await db.select({ id: users.id, name: users.name, role: users.role, email: users.email }).from(users).where(eq(users.id, id)).limit(1);
  return u ?? null;
}

import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../src/config/db.js";
import { passwordSchema, emailSchema } from "../../shared/contracts.js";
const input = z
  .object({ ADMIN_EMAIL: emailSchema, ADMIN_PASSWORD: passwordSchema })
  .parse(process.env);
if (await db.user.findUnique({ where: { email: input.ADMIN_EMAIL } }))
  throw new Error(
    "This email already has an account. Use a new administrator email; existing roles are never silently elevated.",
  );
await db.user.create({
  data: {
    name: "Store administrator",
    email: input.ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(input.ADMIN_PASSWORD, 12),
    role: "ADMIN",
    verifiedAt: new Date(),
  },
});
console.log(
  "Administrator created. Remove ADMIN_PASSWORD from your environment now.",
);
await db.$disconnect();

import bcrypt from "bcryptjs";
import { db } from "../../backend/src/config/db.js";
if (
  process.env.NODE_ENV !== "test" ||
  !new URL(process.env.DATABASE_URL!).pathname.startsWith("/cozzy_test_")
)
  throw new Error("Browser fixtures require an isolated test database.");
try {
  await db.user.create({
    data: {
      name: "Browser Admin",
      email: "admin@example.test",
      passwordHash: await bcrypt.hash("browser admin password 123", 12),
      role: "ADMIN",
      verifiedAt: new Date(),
    },
  });
  await db.user.create({
    data: {
      name: "COD Browser",
      email: "cod@example.test",
      passwordHash: await bcrypt.hash("browser COD password 123", 12),
      verifiedAt: new Date(),
    },
  });
} finally {
  await db.$disconnect();
}

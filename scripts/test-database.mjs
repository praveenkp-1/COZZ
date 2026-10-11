import { Client } from "pg";
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
config({ path: path.join(root, ".env"), quiet: true });
export function run(args, env, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Test command failed (${code})`)),
    );
  });
}
export async function testDatabase() {
  if (process.env.NODE_ENV === "production")
    throw new Error("Tests never run against the production environment.");
  const source = new URL(
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  );
  if (!["127.0.0.1", "localhost", "postgres"].includes(source.hostname))
    throw new Error("Tests require a local PostgreSQL server.");
  const database = `cozzy_test_${randomBytes(8).toString("hex")}`;
  const control = new URL(source);
  control.pathname = "/postgres";
  const client = new Client({ connectionString: control.href });
  await client.connect();
  await client.query(`CREATE DATABASE "${database}"`);
  await client.end();
  const target = new URL(source);
  target.pathname = "/" + database;
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_URL: target.href,
    APP_ORIGIN: "http://127.0.0.1:4173",
    PUBLIC_API_ORIGIN: "http://127.0.0.1:4173",
    PORT: "4173",
    DEMO_INVENTORY: "true",
    PAYHERE_MODE: "sandbox",
    PAYHERE_MERCHANT_ID:
      process.env.TEST_PAYHERE_UNCONFIGURED === "true" ? "" : "test-merchant",
    PAYHERE_MERCHANT_SECRET:
      process.env.TEST_PAYHERE_UNCONFIGURED === "true"
        ? ""
        : "test-only-not-a-real-merchant-secret",
    SMTP_HOST: "",
    CLOUDINARY_CLOUD_NAME: "",
  };
  async function cleanup() {
    if (process.env.KEEP_TEST_DATABASE === "true") {
      console.log(`Retained isolated test database ${database}.`);
      return;
    }
    if (!/^cozzy_test_[a-f0-9]{16}$/.test(database))
      throw new Error("Unsafe test database name.");
    const c = new Client({ connectionString: control.href });
    await c.connect();
    try {
      await c.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    } finally {
      await c.end();
    }
  }
  try {
    await run(
      [
        path.join(root, "node_modules/prisma/build/index.js"),
        "migrate",
        "deploy",
      ],
      env,
      path.join(root, "backend"),
    );
    await run(["--import", "tsx", "backend/prisma/seed.ts"], env);
  } catch (e) {
    await cleanup();
    throw e;
  }
  return { env, cleanup };
}

import { testDatabase, run } from "./test-database.mjs";
import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { createServer } from "node:net";
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once("error", () =>
    reject(
      new Error(
        "Port 4173 is already in use. Stop that process before running browser tests.",
      ),
    ),
  );
  probe.listen(4173, "127.0.0.1", () => probe.close(resolve));
});
const database = await testDatabase();
let server, log;
try {
  await run(["--import", "tsx", "tests/e2e/seed.ts"], database.env);
  await mkdir(".local", { recursive: true });
  log = await open(".local/e2e-server.log", "w");
  server = spawn(process.execPath, ["backend/dist/backend/src/server.js"], {
    env: database.env,
    stdio: ["ignore", log.fd, log.fd],
    windowsHide: true,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null)
      throw new Error("Browser test server exited. See .local/e2e-server.log.");
    try {
      if ((await fetch(database.env.APP_ORIGIN + "/health/ready")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Browser test server did not become ready.");
  await run(
    ["node_modules/@playwright/test/cli.js", "test", ...process.argv.slice(2)],
    database.env,
  );
} finally {
  if (server && server.exitCode === null) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }
  await log?.close();
  await database.cleanup();
}

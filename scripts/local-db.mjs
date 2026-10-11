import EmbeddedPostgres from "embedded-postgres";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { appendFileSync, closeSync, openSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { config } from "dotenv";
import { Client } from "pg";

function runControl(executable, args) {
  return new Promise((resolve, reject) => {
    // Windows pg_ctl launches a long-lived cmd.exe for postgres. Do not give
    // that process captured pipes: execFile waits for their EOF after pg_ctl
    // has already exited, which would leave the startup promise pending.
    const output = openSync(controlLogPath, "a");
    let child;
    try {
      child = spawn(executable, args, {
        windowsHide: true,
        // Isolate PostgreSQL workers from the helper terminal's Ctrl+C event.
        detached: process.platform === "win32",
        stdio: ["ignore", output, output],
        env: { ...process.env, LC_MESSAGES: "C" },
      });
    } finally {
      closeSync(output);
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `pg_ctl exited with code ${code}, signal ${signal ?? "none"}.`,
          ),
        );
    });
  });
}
const root = path.resolve(import.meta.dirname, "..");
const dir = path.join(root, ".local/postgres");
const logPath = path.join(root, ".local/postgres.log");
const controlLogPath = path.join(root, ".local/postgres-control.log");
const helperLogPath = path.join(root, ".local/postgres-helper-output.log");

// Never initialize an existing, nonempty directory with a missing version file.
export async function clusterVersion(directory) {
  try {
    const version = (
      await readFile(path.join(directory, "PG_VERSION"), "utf8")
    ).trim();
    if (!/^\d+$/.test(version))
      throw new Error("Invalid PG_VERSION; existing data was left untouched.");
    return version;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    let entries;
    try {
      entries = await readdir(directory);
    } catch (directoryError) {
      if (directoryError.code !== "ENOENT") throw directoryError;
      entries = [];
    }
    if (entries.length)
      throw new Error(
        "PG_VERSION is missing from a nonempty data directory. Refusing to initialize or reset it.",
      );
    return null;
  }
}

export function startupError(error, phase, diagnostics = "") {
  let detail =
    error instanceof Error
      ? error.message
      : String(error ?? "PostgreSQL exited without an error object.");
  if (diagnostics) detail += `\n${diagnostics.trim()}`;
  if (detail.includes("pre-existing shared memory block is still in use")) {
    detail +=
      "\nWindows still has PostgreSQL shared memory in use. Run db:local in a normal PowerShell terminal outside the restricted sandbox. Close any previous helper cleanly; if leftover processes persist, restart Windows. Keep .local/postgres and its lock files intact.";
  }
  return new Error(
    `Local PostgreSQL failed during ${phase}: ${detail}\nDiagnostics: ${logPath}`,
    { cause: error },
  );
}

// The pinned embedded-postgres start() rejects with undefined, and stop() uses
// taskkill /f on Windows. Its bundled pg_ctl supports detached starts and clean,
// checkpointed shutdowns. The package's own exit hook invokes this stop() too.
class WindowsPostgres extends EmbeddedPostgres {
  #control;
  #startPromise;
  #stopPromise;
  #pid;
  constructor(options, control) {
    super(options);
    this.#control = control;
  }
  start() {
    this.#startPromise = this.#start();
    return this.#startPromise;
  }
  async #start() {
    await runControl(this.#control, [
      "start",
      "-D",
      this.options.databaseDir,
      "-l",
      logPath,
      "-w",
      "-t",
      "60",
      "-o",
      `-p ${this.options.port} ${this.options.postgresFlags.join(" ")}`,
    ]);
    this.#pid = (
      await readFile(
        path.join(this.options.databaseDir, "postmaster.pid"),
        "utf8",
      )
    ).split(/\r?\n/)[0];
  }
  async stop() {
    if (this.#startPromise) await this.#startPromise.catch(() => {});
    if (!this.#pid) return;
    this.#stopPromise ??= this.#stop().catch((error) => {
      this.options.onError(
        `Clean shutdown failed: ${error.message}. PostgreSQL data was preserved. See ${logPath}`,
      );
      process.exitCode = 1;
    });
    await this.#stopPromise;
  }
  async #stop() {
    let currentPid;
    try {
      currentPid = (
        await readFile(
          path.join(this.options.databaseDir, "postmaster.pid"),
          "utf8",
        )
      ).split(/\r?\n/)[0];
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    // Never stop a server another process has started in our place.
    if (currentPid === this.#pid) {
      await runControl(this.#control, [
        "stop",
        "-D",
        this.options.databaseDir,
        "-m",
        "fast",
        "-w",
        "-t",
        "8",
      ]);
      this.options.onLog("Local PostgreSQL stopped cleanly.");
    }
    this.#pid = undefined;
  }
}

async function main() {
  let phase = "configuration";
  let pg;
  let recentLog = "";
  const logOffsets = new Map();
  let redact = (message) => String(message);
  const log = (message) => {
    const text = redact(message);
    recentLog = (recentLog + text).slice(-12000);
    // Native Windows redirects hold their log files open. Keep helper writes
    // separate so another invocation can inspect/reuse a running server.
    appendFileSync(helperLogPath, text.endsWith("\n") ? text : `${text}\n`);
    process.stderr.write(text.endsWith("\n") ? text : `${text}\n`);
  };
  try {
    await mkdir(path.dirname(dir), { recursive: true });
    const version = await clusterVersion(dir);
    const envPath = path.join(root, ".env");
    try {
      await access(envPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (version)
        throw new Error(
          "Existing PostgreSQL data found but .env is missing. Restore the matching .env; credentials will not be replaced.",
        );
      const template = await readFile(path.join(root, ".env.example"), "utf8");
      try {
        await writeFile(
          envPath,
          template.replace(
            "change-this-local-password",
            randomBytes(24).toString("hex"),
          ),
          { mode: 0o600, flag: "wx" },
        );
        console.log("Created .env with a random local database password.");
      } catch (writeError) {
        if (writeError.code !== "EEXIST") throw writeError;
      }
    }
    config({ path: envPath, quiet: true });
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "The embedded database helper is for local development only.",
      );
    const url = new URL(process.env.DATABASE_URL);
    if (
      !["postgresql:", "postgres:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost"].includes(url.hostname) ||
      url.pathname !== "/cozzy"
    ) {
      throw new Error(
        "db:local only manages a local PostgreSQL database named cozzy.",
      );
    }
    const password = decodeURIComponent(url.password);
    redact = (message) => {
      let text = String(message).replaceAll(
        process.env.DATABASE_URL,
        "[DATABASE_URL]",
      );
      for (const secret of [password, url.password].filter(Boolean))
        text = text.replaceAll(secret, "[REDACTED]");
      return text;
    };
    const runHeader = `\n--- db:local ${new Date().toISOString()} ---\n`;
    appendFileSync(helperLogPath, runHeader);
    const options = {
      databaseDir: dir,
      user: decodeURIComponent(url.username),
      password,
      port: Number(url.port) || 55432,
      persistent: true,
      authMethod: "scram-sha-256",
      postgresFlags: [
        "-h",
        "127.0.0.1",
        "-c",
        "log_error_verbosity=verbose",
        "-c",
        "log_min_messages=info",
        "-c",
        "logging_collector=off",
      ],
      onLog: log,
      onError: log,
    };
    const clientOptions = {
      user: options.user,
      password,
      host: "127.0.0.1",
      port: options.port,
      database: "postgres",
      connectionTimeoutMillis: 5000,
    };
    phase = "checking the existing server";
    const probe = new Client(clientOptions);
    let alreadyRunning = false;
    try {
      await probe.connect();
      const { rows } = await probe.query("SHOW data_directory");
      const actualDirectory = path.resolve(rows[0].data_directory);
      const matches =
        process.platform === "win32"
          ? actualDirectory.toLowerCase() === dir.toLowerCase()
          : actualDirectory === dir;
      if (!matches) {
        throw new Error(
          `Port ${options.port} belongs to a different PostgreSQL cluster. Close that server or use its DATABASE_URL separately.`,
        );
      }
      alreadyRunning = true;
    } catch (error) {
      if (error.code !== "ECONNREFUSED") throw error;
    } finally {
      await probe.end();
    }

    if (!alreadyRunning) {
      // An unreachable server may still be starting or recovering. In particular,
      // Windows sandboxes can connect over TCP yet fail native process checks.
      // Never let a second postmaster overwrite the first one's lock file.
      try {
        const pidText = await readFile(
          path.join(dir, "postmaster.pid"),
          "utf8",
        );
        const pid = Number(pidText.split(/\r?\n/)[0]);
        if (!Number.isSafeInteger(pid) || pid <= 0)
          throw new Error(
            "Invalid postmaster.pid. Existing data and lock files were left untouched.",
          );
        let exists = true;
        try {
          process.kill(pid, 0);
        } catch (error) {
          if (error.code !== "ESRCH")
            throw new Error(
              "Cannot verify the existing PostgreSQL process. Run db:local in a normal PowerShell terminal with the same Windows account.",
              { cause: error },
            );
          exists = false;
        }
        if (exists)
          throw new Error(
            `PostgreSQL PID ${pid} still exists but is not accepting connections. Let recovery finish or close the previous helper cleanly. Do not remove postmaster.pid or reset the data directory.`,
          );
        // PostgreSQL itself safely checks a stale PID file during startup.
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const manifest = JSON.parse(
        await readFile(
          new URL("../package.json", import.meta.resolve("embedded-postgres")),
          "utf8",
        ),
      );
      const major = manifest.version.split(".")[0];
      if (version && version !== major)
        throw new Error(
          `Existing PostgreSQL ${version} data cannot be opened with PostgreSQL ${major}. Install the matching embedded-postgres version; data was left untouched.`,
        );
      phase = "loading PostgreSQL binaries";
      pg =
        process.platform === "win32"
          ? new WindowsPostgres(
              options,
              (await import("@embedded-postgres/windows-x64")).pg_ctl,
            )
          : new EmbeddedPostgres(options);
      if (!version) {
        phase = "initialization";
        log("Initializing a new, empty PostgreSQL data directory.");
        await pg.initialise();
      } else {
        log(
          `Using existing PostgreSQL ${version} data; initialization skipped.`,
        );
      }
      phase = "startup";
      for (const file of [logPath, controlLogPath]) {
        try {
          logOffsets.set(file, (await stat(file)).size);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          logOffsets.set(file, 0);
        }
      }
      console.log(
        `Starting PostgreSQL on 127.0.0.1:${options.port}. Diagnostics: ${logPath}`,
      );
      await pg.start();
    }
    phase = "database connection";
    const client = new Client(clientOptions);
    try {
      await client.connect();
      const existing = await client.query(
        "SELECT 1 FROM pg_database WHERE datname = 'cozzy'",
      );
      if (!existing.rowCount) await client.query('CREATE DATABASE "cozzy"');
    } finally {
      await client.end();
    }
    const application = new Client({ ...clientOptions, database: "cozzy" });
    try {
      await application.connect();
      await application.query("SELECT 1");
    } finally {
      await application.end();
    }
    console.log(
      `Local PostgreSQL is ready on 127.0.0.1:${options.port}. Data persists in .local/postgres.`,
    );
    if (alreadyRunning) {
      console.log(
        "Reusing the existing COZZY server; its original terminal controls shutdown.",
      );
      return;
    }
    console.log("Keep this terminal open. Press Ctrl+C for a clean shutdown.");
    // embedded-postgres registers an async exit hook that invokes pg.stop().
    setInterval(() => {}, 60000);
  } catch (error) {
    if (phase === "startup" && process.platform === "win32") {
      for (const file of [logPath, controlLogPath]) {
        const contents = await readFile(file).catch(() => Buffer.alloc(0));
        recentLog += contents
          .subarray(logOffsets.get(file) ?? 0)
          .toString("utf8")
          .slice(-12000);
      }
    } else if (phase === "startup") {
      appendFileSync(logPath, recentLog);
    }
    console.error(redact(startupError(error, phase, recentLog).message));
    if (pg) await pg.stop();
    // async-exit-hook's beforeExit handler otherwise replaces exitCode with 0.
    // Owned PostgreSQL has already been stopped before this explicit exit.
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename)
  await main();

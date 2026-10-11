import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { clusterVersion, startupError } from "../../scripts/local-db.mjs";

const fixtures: { directory: string; files: string[] }[] = [];
async function fixture(files: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "cozzy-db-guard-"));
  fixtures.push({ directory, files: Object.keys(files) });
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(path.join(directory, name), contents);
  }
  return directory;
}
afterEach(async () => {
  for (const { directory, files } of fixtures.splice(0)) {
    for (const name of files) await unlink(path.join(directory, name));
    await rmdir(directory);
  }
});

describe("local PostgreSQL data preservation", () => {
  it("allows initialization only for missing or empty directories", async () => {
    const directory = await fixture();
    expect(await clusterVersion(directory)).toBeNull();
    expect(await clusterVersion(path.join(directory, "absent"))).toBeNull();
  });

  it("reads an existing cluster version without changing files", async () => {
    const directory = await fixture({
      PG_VERSION: "18\r\n",
      sentinel: "existing records",
    });
    expect(await clusterVersion(directory)).toBe("18");
    expect(await readFile(path.join(directory, "PG_VERSION"), "utf8")).toBe(
      "18\r\n",
    );
    expect(await readFile(path.join(directory, "sentinel"), "utf8")).toBe(
      "existing records",
    );
  });

  it("refuses to initialize nonempty data with a missing version file", async () => {
    const directory = await fixture({ sentinel: "do not overwrite" });
    await expect(clusterVersion(directory)).rejects.toThrow(
      "Refusing to initialize or reset",
    );
    expect(await readFile(path.join(directory, "sentinel"), "utf8")).toBe(
      "do not overwrite",
    );
  });

  it("preserves malformed version files instead of attempting initialization", async () => {
    const directory = await fixture({ PG_VERSION: "damaged" });
    await expect(clusterVersion(directory)).rejects.toThrow(
      "Invalid PG_VERSION",
    );
    expect(await readFile(path.join(directory, "PG_VERSION"), "utf8")).toBe(
      "damaged",
    );
  });

  it("propagates filesystem errors rather than treating them as an empty cluster", async () => {
    const directory = await fixture();
    await mkdir(path.join(directory, "PG_VERSION"));
    try {
      await expect(clusterVersion(directory)).rejects.toMatchObject({
        code: "EISDIR",
      });
    } finally {
      await rmdir(path.join(directory, "PG_VERSION"));
    }
  });
});

describe("PostgreSQL startup diagnostics", () => {
  it("turns the upstream undefined rejection into a useful startup error", () => {
    const error = startupError(
      undefined,
      "startup",
      "FATAL: pre-existing shared memory block is still in use",
    );
    expect(error.message).toContain("failed during startup");
    expect(error.message).toContain("FATAL: pre-existing shared memory block");
    expect(error.message).toContain("outside the restricted sandbox");
    expect(error.message).toContain(
      "Keep .local/postgres and its lock files intact",
    );
    expect(error.message).toContain("postgres.log");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type LockedPackage = {
  version: string;
  optional?: boolean;
  optionalDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
};
const { packages } = JSON.parse(
  readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"),
) as { packages: Record<string, LockedPackage> };

describe("cross-platform native CSS dependencies", () => {
  it("locks every Oxide binding at the version requested by its parent", () => {
    const oxide = packages["node_modules/@tailwindcss/oxide"];
    const bindings = Object.entries(oxide.optionalDependencies ?? {});
    expect(bindings.length).toBeGreaterThan(0);
    for (const [name, version] of bindings) {
      expect(packages[`node_modules/${name}`], `Missing ${name}`).toMatchObject(
        {
          version,
          optional: true,
        },
      );
    }
  });

  it.each([
    ["linux-x64-gnu", { os: ["linux"], cpu: ["x64"], libc: ["glibc"] }],
    ["linux-x64-musl", { os: ["linux"], cpu: ["x64"], libc: ["musl"] }],
    ["win32-x64-msvc", { os: ["win32"], cpu: ["x64"] }],
  ])("retains platform constraints for %s", (platform, constraints) => {
    expect(
      packages[`node_modules/@tailwindcss/oxide-${platform}`],
    ).toMatchObject(constraints);
  });
});

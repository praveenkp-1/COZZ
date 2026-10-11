import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { mediaFilename, readCatalog } from "../../scripts/build-assets.mjs";

const products = JSON.parse(readFileSync("data/products.json", "utf8"));

describe("maintained product catalog and assets", () => {
  it("preserves every migrated product, price, description, size and gallery", async () => {
    expect(await readCatalog()).toHaveLength(34);
    expect(
      createHash("sha256").update(JSON.stringify(products)).digest("hex"),
    ).toBe("6534a43d75fb1875c66527081d832891d238db28c55e8e7a27d31a31064cce8f");
  });
  it("retains the seven detailed products and original LKR prices", () => {
    expect(products.filter((product) => product.legacyId)).toHaveLength(7);
    expect(products.find((product) => product.legacyId === 1).price).toBe(
      799900,
    );
    expect(products.find((product) => product.legacyId === 7).price).toBe(
      889900,
    );
  });
  it("resolves all original images, responsive derivatives and product references", () => {
    for (const product of products) {
      if (product.reference) expect(existsSync(product.reference)).toBe(true);
      for (const image of product.images) {
        expect(existsSync(image.source)).toBe(true);
        expect(image.url).toBe(`/media/${mediaFilename(image.source)}`);
        const file = path.join("frontend/public", image.url);
        for (const derivative of [
          file,
          file.replace(/\.webp$/, "-480.webp"),
          file.replace(/\.webp$/, "-960.webp"),
        ]) {
          expect(existsSync(derivative)).toBe(true);
        }
      }
    }
  });
  it.each([
    "../private.jpg",
    "source/../private.jpg",
    "source/./image.jpg",
    "source\\image.jpg",
    "source//image.jpg",
    "source/notes.txt",
  ])("rejects invalid image source %s", (source) =>
    expect(() => mediaFilename(source)).toThrow("Invalid catalog image source"),
  );
});

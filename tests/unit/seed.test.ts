import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({
  products: new Map<string, any>(),
  variants: [] as any[],
  collections: [] as any[],
}));
vi.mock("../../backend/src/config/db.js", () => ({
  db: {
    storeSettings: { upsert: vi.fn(async () => ({})) },
    category: {
      upsert: vi.fn(async ({ create }) => ({ ...create, id: create.slug })),
    },
    product: {
      findUnique: vi.fn(
        async ({ where }) => state.products.get(where.slug) ?? null,
      ),
      create: vi.fn(async ({ data }) => {
        const record = { ...data, id: data.slug, images: data.images.create };
        state.products.set(data.slug, record);
        return record;
      }),
      findMany: vi.fn(async ({ where }) =>
        [...state.products.values()].filter(
          (product) => product.gender === where.gender,
        ),
      ),
    },
    productVariant: {
      create: vi.fn(async ({ data }) => {
        state.variants.push(data);
        return data;
      }),
    },
    shippingMethod: { upsert: vi.fn(async () => ({})) },
    collection: {
      upsert: vi.fn(async ({ create }) => {
        state.collections.push(create);
        return create;
      }),
    },
    async $transaction(callback) {
      return callback(this);
    },
    $disconnect: vi.fn(async () => {}),
  },
}));
vi.mock("../../backend/src/config/env.js", () => ({
  env: { NODE_ENV: "test" },
}));

beforeEach(() => {
  vi.resetModules();
  state.products.clear();
  state.variants.length = 0;
  state.collections.length = 0;
  vi.stubEnv("DEMO_INVENTORY", "false");
});
afterEach(() => vi.unstubAllEnvs());

describe("catalog seeding without database writes", () => {
  it("seeds the maintained JSON with original prices/images and zero inventory", async () => {
    await import("../../backend/prisma/seed.ts");
    const catalog = JSON.parse(readFileSync("data/products.json", "utf8"));
    expect(state.products.size).toBe(34);
    for (const source of catalog) {
      const seeded = state.products.get(source.slug);
      expect(seeded.price).toBe(source.price);
      expect(seeded.description).toBe(source.description);
      expect(seeded.images.map((image) => image.url)).toEqual(
        source.images.map((image) => image.url),
      );
    }
    expect(state.variants.length).toBeGreaterThan(34);
    expect(
      state.variants.every((variant) => variant.inventory.create.stock === 0),
    ).toBe(true);
    expect(state.collections.map((collection) => collection.slug)).toEqual([
      "men",
      "women",
    ]);
  });
  it("preserves existing products and inventory when reseeded", async () => {
    await import("../../backend/prisma/seed.ts");
    const product = [...state.products.values()][0];
    product.price = 123456;
    state.variants[0].inventory.create.stock = 7;
    const previous = JSON.stringify({
      products: [...state.products],
      variants: state.variants,
    });
    vi.resetModules();
    await import("../../backend/prisma/seed.ts");
    expect(
      JSON.stringify({
        products: [...state.products],
        variants: state.variants,
      }),
    ).toBe(previous);
  });
});

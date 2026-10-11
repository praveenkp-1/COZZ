import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../src/config/db.js";
import { env } from "../src/config/env.js";
interface SourceProduct {
  name: string;
  slug: string;
  legacyId?: number;
  description: string;
  gender: string;
  price: number;
  category: string;
  color: string;
  sizes: string[];
  featured: boolean;
  images: { url: string; alt: string }[];
}
const root = process.cwd().endsWith("backend")
  ? path.resolve("..")
  : process.cwd();
const products: SourceProduct[] = JSON.parse(
  await readFile(path.join(root, "data/products.json"), "utf8"),
);
const demo =
  process.env.DEMO_INVENTORY === "true" && env.NODE_ENV !== "production";
await db.storeSettings.upsert({
  where: { id: "store" },
  create: { id: "store" },
  update: {},
});
const cats = new Map<string, string>();
for (const slug of [...new Set(products.map((p) => p.category))]) {
  const c = await db.category.upsert({
    where: { slug },
    create: { slug, name: slug[0].toUpperCase() + slug.slice(1) },
    update: {},
  });
  cats.set(slug, c.id);
}
for (const p of products) {
  await db.$transaction(async (tx) => {
    if (await tx.product.findUnique({ where: { slug: p.slug } })) return;
    const product = await tx.product.create({
      data: {
        name: p.name,
        slug: p.slug,
        legacyId: p.legacyId,
        description: p.description,
        gender: p.gender,
        price: p.price,
        categoryId: cats.get(p.category)!,
        featured: p.featured,
        images: {
          create: p.images.map((image, position) => ({
            url: image.url,
            alt: image.alt,
            position,
          })),
        },
      },
    });
    for (const size of [...new Set(p.sizes)])
      await tx.productVariant.create({
        data: {
          productId: product.id,
          sku: `CZ-${p.slug.slice(0, 45)}-${size}`.toUpperCase(),
          size,
          color: p.color,
          inventory: { create: { stock: demo ? 12 : 0 } },
        },
      });
  });
}
await db.shippingMethod.upsert({
  where: { id: "standard" },
  create: {
    id: "standard",
    name: "Standard delivery",
    description: "Delivery timing is confirmed by customer care.",
    fee: 50000,
    freeAbove: 1500000,
  },
  update: {},
});
for (const gender of ["men", "women"]) {
  const selected = await db.product.findMany({
    where: { gender, active: true },
    include: { images: { take: 1, orderBy: { position: "asc" } } },
  });
  if (!selected.length) continue;
  await db.collection.upsert({
    where: { slug: gender },
    create: {
      slug: gender,
      name: gender === "men" ? "For him" : "For her",
      description:
        gender === "men"
          ? "Everyday essentials. Effortlessly yours."
          : "Considered pieces. Individual style.",
      image: selected[0].images[0].url,
      products: { create: selected.map((p) => ({ productId: p.id })) },
    },
    update: {},
  });
}
console.log(
  `Seeded ${products.length} original products. ${demo ? "Development sample stock enabled." : "Stock starts at zero; set real inventory in admin."} Existing records were preserved.`,
);
await db.$disconnect();

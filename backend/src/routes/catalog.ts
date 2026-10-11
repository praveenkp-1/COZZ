import { Router } from "express";
import { db } from "../config/db.js";
import { paymentConfigured, env } from "../config/env.js";
import { productQuerySchema } from "../../../shared/contracts.js";
import { productInclude } from "../services/cart.js";
import { assert } from "../utils/errors.js";
import type { Prisma } from "../generated/prisma/client.js";
export const catalogRouter = Router();
export async function listProducts(raw: unknown) {
  const q = productQuerySchema.parse(raw);
  const where: Prisma.ProductWhereInput = {
    active: true,
    price: { gte: q.min, lte: q.max },
    ...(q.q
      ? {
          OR: [
            { name: { contains: q.q, mode: "insensitive" } },
            { description: { contains: q.q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(q.gender ? { gender: q.gender } : {}),
    ...(q.category
      ? {
          category: {
            OR: [{ slug: q.category }, { parent: { slug: q.category } }],
          },
        }
      : {}),
    ...(q.featured ? { featured: q.featured === "true" } : {}),
    ...(q.collection
      ? {
          collections: {
            some: { collection: { slug: q.collection, active: true } },
          },
        }
      : {}),
    ...(q.size || q.color
      ? {
          variants: {
            some: {
              active: true,
              ...(q.size ? { size: q.size } : {}),
              ...(q.color ? { color: q.color } : {}),
            },
          },
        }
      : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    q.sort === "price-asc"
      ? [{ price: "asc" }, { id: "asc" }]
      : q.sort === "price-desc"
        ? [{ price: "desc" }, { id: "asc" }]
        : q.sort === "popular"
          ? [{ salesCount: "desc" }, { id: "asc" }]
          : [{ createdAt: "desc" }, { id: "asc" }];
  const [items, total] = await db.$transaction([
    db.product.findMany({
      where,
      include: productInclude,
      orderBy,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    db.product.count({ where }),
  ]);
  return { items, total, page: q.page, pages: Math.ceil(total / q.limit) };
}
export async function storeData() {
  const [
    settings,
    categories,
    shippingMethods,
    collections,
    banners,
    variants,
  ] = await Promise.all([
    db.storeSettings.findUniqueOrThrow({ where: { id: "store" } }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.shippingMethod.findMany({ where: { active: true } }),
    db.collection.findMany({ where: { active: true } }),
    db.banner.findMany({ where: { active: true } }),
    db.productVariant.findMany({
      where: { active: true, product: { active: true } },
      select: { size: true, color: true },
      distinct: ["size", "color"],
    }),
  ]);
  return {
    settings,
    categories,
    shippingMethods,
    collections,
    banners,
    sizes: [...new Set(variants.map((v) => v.size))],
    colors: [...new Set(variants.map((v) => v.color))],
    paymentEnabled: paymentConfigured,
    paymentMode: env.PAYHERE_MODE,
  };
}
export async function findProduct(slug: string) {
  const product = await db.product.findFirst({
    where: { slug, active: true },
    include: {
      ...productInclude,
      reviews: {
        where: { approved: true },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          createdAt: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });
  assert(product, 404, "This product could not be found.");
  const rating = await db.review.aggregate({
    where: { productId: product.id, approved: true },
    _avg: { rating: true },
    _count: true,
  });
  return { ...product, rating: rating._avg.rating, reviewCount: rating._count };
}
catalogRouter.get("/products", async (req, res) =>
  res.json(await listProducts(req.query)),
);
catalogRouter.get("/products/:slug", async (req, res) =>
  res.json(await findProduct(String(req.params.slug))),
);
catalogRouter.get("/store", async (_req, res) => res.json(await storeData()));
catalogRouter.get("/categories", async (_req, res) =>
  res.json(await db.category.findMany({ orderBy: { name: "asc" } })),
);

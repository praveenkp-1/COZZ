import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import sharp from "sharp";
import { v2 as cloudinary } from "cloudinary";
import { db } from "../config/db.js";
import { env } from "../config/env.js";
import { administrator } from "../middleware/auth.js";
import {
  productSchema,
  couponSchema,
  settingsSchema,
  shippingSchema,
  imageSchema,
} from "../../../shared/contracts.js";
import { assert } from "../utils/errors.js";
import { serializable } from "../utils/transaction.js";
import { productInclude } from "../services/cart.js";
import {
  orderInclude,
  releaseReservation,
  commitReservation,
  collectCashPayment,
} from "../services/orders.js";
import { queueEmail } from "../services/mail.js";
import type { Prisma } from "../generated/prisma/client.js";
const adminOrderInclude = {
  ...orderInclude,
  payment: { include: { collectedBy: { select: { id: true, name: true } } } },
} satisfies Prisma.OrderInclude;
export const adminRouter = Router();
adminRouter.use(administrator);
async function audit(
  tx: Prisma.TransactionClient,
  userId: string,
  action: string,
  targetId: string,
  detail: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({ data: { userId, action, targetId, detail } });
}
const pageQuery = z.object({
  q: z.string().max(100).default(""),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  status: z.string().max(40).default(""),
});
adminRouter.get("/overview", async (_req, res) => {
  const [orders, customers, products, lowStock, recentOrders, paid] =
    await Promise.all([
      db.order.count(),
      db.user.count({ where: { role: "CUSTOMER" } }),
      db.product.count({ where: { active: true } }),
      db.inventory.findMany({
        where: {
          stock: { lte: 5 },
          variant: { active: true, product: { active: true } },
        },
        include: {
          variant: {
            include: { product: { select: { name: true, slug: true } } },
          },
        },
        take: 50,
        orderBy: { stock: "asc" },
      }),
      db.order.findMany({
        include: adminOrderInclude,
        take: 8,
        orderBy: { createdAt: "desc" },
      }),
      db.payment.findMany({
        where: { status: "PAID" },
        select: { amount: true, updatedAt: true },
      }),
    ]);
  const revenue = paid.reduce((s, p) => s + p.amount, 0);
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(Date.now() - (13 - i) * 86400000)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      revenue: paid
        .filter((p) => p.updatedAt.toISOString().startsWith(date))
        .reduce((s, p) => s + p.amount, 0),
    };
  });
  res.json({
    orders,
    customers,
    products,
    revenue,
    lowStock,
    recentOrders,
    days,
  });
});
adminRouter.get("/products", async (req, res) => {
  const q = pageQuery.parse(req.query);
  const where = {
    ...(q.q ? { name: { contains: q.q, mode: "insensitive" as const } } : {}),
  };
  const [items, total] = await db.$transaction([
    db.product.findMany({
      where,
      include: productInclude,
      take: 20,
      skip: (q.page - 1) * 20,
      orderBy: { updatedAt: "desc" },
    }),
    db.product.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pages: Math.ceil(total / 20) });
});
async function saveProduct(
  input: z.infer<typeof productSchema>,
  userId: string,
  id?: string,
) {
  return serializable(async (tx) => {
    if (id)
      assert(
        await tx.product.findUnique({ where: { id } }),
        404,
        "Product not found.",
      );
    const { images, variants, ...base } = input;
    const product = id
      ? await tx.product.update({ where: { id }, data: base })
      : await tx.product.create({ data: base });
    await tx.productImage.deleteMany({ where: { productId: product.id } });
    await tx.productImage.createMany({
      data: images.map((x, i) => ({
        ...x,
        position: i,
        productId: product.id,
      })),
    });
    await tx.productVariant.updateMany({
      where: { productId: product.id },
      data: { active: false },
    });
    for (const variant of variants) {
      const { stock, id: variantId, ...data } = variant;
      if (variantId)
        assert(
          await tx.productVariant.findFirst({
            where: { id: variantId, productId: product.id },
          }),
          400,
          "Variant does not belong to this product.",
        );
      const saved = await tx.productVariant.upsert({
        where: {
          productId_size_color: {
            productId: product.id,
            size: data.size,
            color: data.color,
          },
        },
        create: {
          ...data,
          productId: product.id,
          inventory: { create: { stock } },
        },
        update: { ...data, active: true },
      });
      await tx.inventory.upsert({
        where: { variantId: saved.id },
        create: { variantId: saved.id, stock },
        update: { stock },
      });
    }
    await audit(
      tx,
      userId,
      id ? "product.update" : "product.create",
      product.id,
      { name: product.name },
    );
    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productInclude,
    });
  });
}
adminRouter.post("/products", async (req, res) =>
  res
    .status(201)
    .json(
      await saveProduct(productSchema.parse(req.body), req.session.user!.id),
    ),
);
adminRouter.put("/products/:id", async (req, res) =>
  res.json(
    await saveProduct(
      productSchema.parse(req.body),
      req.session.user!.id,
      String(req.params.id),
    ),
  ),
);
adminRouter.delete("/products/:id", async (req, res) => {
  await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: String(req.params.id) },
      data: { active: false },
    });
    await audit(
      tx,
      req.session.user!.id,
      "product.archive",
      String(req.params.id),
    );
  });
  res.json({ archived: true });
});
adminRouter.patch("/inventory/:variantId", async (req, res) => {
  const { stock } = z
    .object({ stock: z.number().int().min(0).max(100000) })
    .strict()
    .parse(req.body);
  await serializable(async (tx) => {
    await tx.inventory.update({
      where: { variantId: String(req.params.variantId) },
      data: { stock },
    });
    await audit(
      tx,
      req.session.user!.id,
      "inventory.update",
      String(req.params.variantId),
      { stock },
    );
  });
  res.json({ updated: true });
});
adminRouter.get("/orders", async (req, res) => {
  const q = pageQuery.parse(req.query);
  const status = q.status
    ? z
        .enum([
          "PENDING_PAYMENT",
          "CONFIRMED",
          "PROCESSING",
          "SHIPPED",
          "DELIVERED",
          "CANCELLED",
          "REFUND_PENDING",
          "REFUNDED",
          "PAYMENT_REVIEW",
        ])
        .parse(q.status)
    : undefined;
  const where = {
    ...(status ? { status } : {}),
    ...(q.q
      ? {
          OR: [
            { number: { contains: q.q, mode: "insensitive" as const } },
            { email: { contains: q.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await db.$transaction([
    db.order.findMany({
      where,
      include: adminOrderInclude,
      take: 20,
      skip: (q.page - 1) * 20,
      orderBy: { createdAt: "desc" },
    }),
    db.order.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pages: Math.ceil(total / 20) });
});
adminRouter.patch("/orders/:id", async (req, res) => {
  const input = z
    .object({
      status: z.enum([
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "CANCELLED",
        "REFUND_PENDING",
        "REFUNDED",
      ]),
      tracking: z.string().trim().max(300).default(""),
      refundReference: z.string().trim().max(200).default(""),
    })
    .strict()
    .parse(req.body);
  await serializable(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: String(req.params.id) },
      include: adminOrderInclude,
    });
    assert(order?.payment, 404, "Order not found.");
    const allowed: Record<string, string[]> = {
      PENDING_PAYMENT: ["CANCELLED"],
      CONFIRMED: ["PROCESSING", "REFUND_PENDING"],
      PROCESSING: ["SHIPPED", "REFUND_PENDING"],
      SHIPPED: ["DELIVERED", "REFUND_PENDING"],
      DELIVERED: ["REFUND_PENDING"],
      REFUND_PENDING: ["REFUNDED"],
      PAYMENT_REVIEW: ["REFUND_PENDING"],
    };
    if (
      order.payment.provider === "COD" &&
      order.payment.status === "PENDING_COLLECTION"
    ) {
      allowed.CONFIRMED = ["PROCESSING", "CANCELLED"];
      allowed.PROCESSING = ["SHIPPED", "CANCELLED"];
      allowed.SHIPPED = ["DELIVERED"];
      allowed.DELIVERED = [];
    }
    assert(
      allowed[order.status]?.includes(input.status),
      409,
      "This order status transition is not allowed.",
    );
    if (input.status === "SHIPPED")
      assert(
        input.tracking,
        400,
        "Provide a tracking reference before marking an order shipped.",
      );
    if (input.status === "CANCELLED") {
      assert(
        ["PENDING", "PENDING_COLLECTION"].includes(order.payment.status),
        409,
        "Paid orders require the refund process.",
      );
      await releaseReservation(tx, order.id);
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "FAILED" },
      });
    }
    if (["PROCESSING", "SHIPPED", "DELIVERED"].includes(input.status))
      assert(
        order.payment.status === "PAID" ||
          (order.payment.provider === "COD" &&
            order.payment.status === "PENDING_COLLECTION"),
        409,
        "This payment state does not allow fulfillment.",
      );
    if (input.status === "SHIPPED" && order.payment.provider === "COD")
      await commitReservation(tx, order.items);
    if (input.status === "REFUND_PENDING")
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "REFUND_PENDING" },
      });
    if (input.status === "REFUNDED") {
      assert(
        input.refundReference,
        400,
        "Record a reference after the refund has been completed through the original payment method.",
      );
      await tx.payment.update({
        where: { orderId: order.id },
        data: { status: "REFUNDED", refundReference: input.refundReference },
      });
    }
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: input.status,
        ...(input.tracking ? { tracking: input.tracking } : {}),
      },
    });
    await audit(tx, req.session.user!.id, "order.status", order.id, {
      from: order.status,
      ...input,
    });
    await queueEmail(
      tx,
      order.email,
      `Order update — ${order.number}`,
      `Your order is now ${input.status.toLowerCase().replaceAll("_", " ")}.${input.tracking ? " Tracking: " + input.tracking : ""}\n${env.APP_ORIGIN}/orders/${order.id}`,
    );
  });
  res.json({ updated: true });
});
adminRouter.post("/orders/:id/collect", async (req, res) => {
  z.object({}).strict().parse(req.body);
  res.json(
    await collectCashPayment(String(req.params.id), req.session.user!.id),
  );
});
adminRouter.get("/customers", async (req, res) => {
  const q = pageQuery.parse(req.query);
  const where = {
    role: "CUSTOMER" as const,
    ...(q.q
      ? {
          OR: [
            { email: { contains: q.q, mode: "insensitive" as const } },
            { name: { contains: q.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await db.$transaction([
    db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        active: true,
        verifiedAt: true,
        createdAt: true,
        _count: { select: { orders: true } },
      },
      take: 20,
      skip: (q.page - 1) * 20,
      orderBy: { createdAt: "desc" },
    }),
    db.user.count({ where }),
  ]);
  res.json({ items, total, page: q.page, pages: Math.ceil(total / 20) });
});
adminRouter.get("/customers/:id/orders", async (req, res) =>
  res.json(
    await db.order.findMany({
      where: { userId: String(req.params.id) },
      include: adminOrderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ),
);
adminRouter.patch("/customers/:id", async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).strict().parse(req.body);
  await db.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: String(req.params.id), role: "CUSTOMER" },
      data: { active },
    });
    assert(result.count, 404, "Customer not found.");
    if (!active)
      await tx.session.deleteMany({ where: { userId: String(req.params.id) } });
    await audit(
      tx,
      req.session.user!.id,
      "customer.status",
      String(req.params.id),
      { active },
    );
  });
  res.json({ updated: true });
});
adminRouter.get("/store", async (_req, res) => {
  const [
    settings,
    shippingMethods,
    coupons,
    categories,
    collections,
    banners,
    reviews,
    messages,
  ] = await Promise.all([
    db.storeSettings.findUniqueOrThrow({ where: { id: "store" } }),
    db.shippingMethod.findMany(),
    db.coupon.findMany({ orderBy: { code: "asc" } }),
    db.category.findMany(),
    db.collection.findMany({ include: { products: true } }),
    db.banner.findMany(),
    db.review.findMany({
      include: {
        product: { select: { name: true } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.contactMessage.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  res.json({
    settings,
    shippingMethods,
    coupons,
    categories,
    collections,
    banners,
    reviews,
    messages,
    uploadsEnabled: !!env.CLOUDINARY_CLOUD_NAME,
  });
});
adminRouter.put("/settings", async (req, res) => {
  const input = settingsSchema.parse(req.body);
  assert(
    !input.policiesPublished ||
      [
        input.privacy,
        input.terms,
        input.shippingPolicy,
        input.returnsPolicy,
      ].every((s) => s.trim().length >= 50),
    400,
    "Publish complete privacy, terms, shipping, and return policies (at least 50 characters each).",
  );
  await db.$transaction(async (tx) => {
    await tx.storeSettings.update({ where: { id: "store" }, data: input });
    await audit(tx, req.session.user!.id, "settings.update", "store");
  });
  res.json({ updated: true });
});
adminRouter.post("/coupons", async (req, res) => {
  const input = couponSchema.parse(req.body);
  const coupon = await db.coupon.create({
    data: { ...input, expiresAt: new Date(input.expiresAt) },
  });
  res.status(201).json(coupon);
});
adminRouter.put("/coupons/:id", async (req, res) => {
  const input = couponSchema.parse(req.body);
  res.json(
    await db.coupon.update({
      where: { id: String(req.params.id) },
      data: { ...input, expiresAt: new Date(input.expiresAt) },
    }),
  );
});
adminRouter.post("/shipping", async (req, res) =>
  res
    .status(201)
    .json(
      await db.shippingMethod.create({ data: shippingSchema.parse(req.body) }),
    ),
);
adminRouter.put("/shipping/:id", async (req, res) =>
  res.json(
    await db.shippingMethod.update({
      where: { id: String(req.params.id) },
      data: shippingSchema.parse(req.body),
    }),
  ),
);
const categorySchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    parentId: z.string().nullable().default(null),
  })
  .strict();
adminRouter.post("/categories", async (req, res) =>
  res
    .status(201)
    .json(await db.category.create({ data: categorySchema.parse(req.body) })),
);
adminRouter.put("/categories/:id", async (req, res) => {
  const input = categorySchema.parse(req.body);
  let parent = input.parentId;
  const seen = new Set([String(req.params.id)]);
  while (parent) {
    assert(!seen.has(parent), 400, "Category parents cannot form a cycle.");
    seen.add(parent);
    parent =
      (await db.category.findUnique({ where: { id: parent } }))?.parentId ??
      null;
  }
  res.json(
    await db.category.update({
      where: { id: String(req.params.id) },
      data: input,
    }),
  );
});
const bannerSchema = z
  .object({
    title: z.string().min(2).max(100),
    description: z.string().max(500),
    image: imageSchema.shape.url,
    href: z.string().regex(/^\/shop(?:\?[a-zA-Z0-9%=&_-]*)?$/),
    active: z.boolean(),
  })
  .strict();
adminRouter.post("/banners", async (req, res) =>
  res
    .status(201)
    .json(await db.banner.create({ data: bannerSchema.parse(req.body) })),
);
adminRouter.put("/banners/:id", async (req, res) =>
  res.json(
    await db.banner.update({
      where: { id: String(req.params.id) },
      data: bannerSchema.parse(req.body),
    }),
  ),
);
const collectionSchema = z
  .object({
    name: z.string().min(2).max(100),
    slug: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .max(100),
    description: z.string().max(500),
    image: imageSchema.shape.url,
    active: z.boolean(),
    productIds: z.array(z.string()).max(200),
  })
  .strict();
async function saveCollection(body: unknown, id?: string) {
  const { productIds, ...input } = collectionSchema.parse(body);
  return db.$transaction(async (tx) => {
    const c = id
      ? await tx.collection.update({ where: { id }, data: input })
      : await tx.collection.create({ data: input });
    await tx.collectionProduct.deleteMany({ where: { collectionId: c.id } });
    await tx.collectionProduct.createMany({
      data: [...new Set(productIds)].map((productId) => ({
        collectionId: c.id,
        productId,
      })),
    });
    return c;
  });
}
adminRouter.post("/collections", async (req, res) =>
  res.status(201).json(await saveCollection(req.body)),
);
adminRouter.put("/collections/:id", async (req, res) =>
  res.json(await saveCollection(req.body, String(req.params.id))),
);
adminRouter.patch("/reviews/:id", async (req, res) => {
  const input = z.object({ approved: z.boolean() }).strict().parse(req.body);
  res.json(
    await db.review.update({
      where: { id: String(req.params.id) },
      data: input,
    }),
  );
});
adminRouter.patch("/messages/:id", async (req, res) => {
  const input = z.object({ resolved: z.boolean() }).strict().parse(req.body);
  res.json(
    await db.contactMessage.update({
      where: { id: String(req.params.id) },
      data: input,
    }),
  );
});
adminRouter.get("/audit", async (_req, res) =>
  res.json(
    await db.auditLog.findMany({
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    cb(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  },
});
adminRouter.post("/uploads", upload.single("image"), async (req, res) => {
  assert(
    env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET,
    503,
    "Image storage is not configured.",
  );
  assert(req.file, 400, "Upload a JPEG, PNG, or WebP image under 8 MB.");
  const image = sharp(req.file.buffer, {
    limitInputPixels: 40000000,
    animated: false,
  });
  const metadata = await image.metadata();
  assert(
    metadata.width &&
      metadata.height &&
      metadata.width <= 12000 &&
      metadata.height <= 12000,
    400,
    "Unsupported image dimensions.",
  );
  const buffer = await image
    .rotate()
    .resize({ width: 2000, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
  const result = await new Promise<{ secure_url: string }>(
    (resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            folder: "cozzy",
            resource_type: "image",
            allowed_formats: ["webp"],
          },
          (error, result) => (error ? reject(error) : resolve(result!)),
        )
        .end(buffer);
    },
  );
  res.status(201).json({ url: result.secure_url });
});

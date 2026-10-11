import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { db } from "../config/db.js";
import { env, paymentConfigured } from "../config/env.js";
import {
  cartItemSchema,
  quoteSchema,
  checkoutSchema,
  addressSchema,
  reviewSchema,
  emailSchema,
} from "../../../shared/contracts.js";
import { authenticated, verified } from "../middleware/auth.js";
import { assert } from "../utils/errors.js";
import { serializable } from "../utils/transaction.js";
import { getCart, quoteCart, productInclude } from "../services/cart.js";
import {
  createOrder,
  orderInclude,
  releaseReservation,
} from "../services/orders.js";
import { paymentFields } from "../services/payhere.js";
import { randomToken, hashToken } from "../utils/crypto.js";
import { queueEmail } from "../services/mail.js";
export const customerRouter = Router();
const addressSelect = {
  id: true,
  name: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  postalCode: true,
  country: true,
} as const;
customerRouter.get("/cart", async (req, res) =>
  res.json(await getCart(db, req.session.cartId)),
);
customerRouter.put("/cart/items", async (req, res) => {
  const input = cartItemSchema.parse(req.body);
  await serializable(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.variantId },
      include: { product: true, inventory: true },
    });
    assert(
      variant?.active && variant.product.active,
      404,
      "This product is unavailable.",
    );
    assert(
      (variant.inventory?.stock ?? 0) >= input.quantity,
      409,
      "The requested quantity is unavailable.",
    );
    const count = await tx.cartItem.count({
      where: { cartId: req.session.cartId },
    });
    const exists = await tx.cartItem.findUnique({
      where: {
        cartId_variantId: {
          cartId: req.session.cartId,
          variantId: input.variantId,
        },
      },
    });
    assert(
      exists || count < 50,
      400,
      "Your bag can contain at most 50 different items.",
    );
    await tx.cartItem.upsert({
      where: {
        cartId_variantId: {
          cartId: req.session.cartId,
          variantId: input.variantId,
        },
      },
      create: { cartId: req.session.cartId, ...input },
      update: { quantity: input.quantity },
    });
  });
  res.json(await getCart(db, req.session.cartId));
});
customerRouter.delete("/cart/items/:id", async (req, res) => {
  await db.cartItem.deleteMany({
    where: { id: String(req.params.id), cartId: req.session.cartId },
  });
  res.json(await getCart(db, req.session.cartId));
});
customerRouter.post("/cart/quote", async (req, res) => {
  const input = quoteSchema.parse(req.body);
  const quote = await quoteCart(
    db,
    req.session.cartId,
    input.shippingMethodId,
    input.couponCode,
  );
  res.json({
    subtotal: quote.subtotal,
    discount: quote.discount,
    shipping: quote.shipping,
    tax: quote.tax,
    total: quote.total,
    currency: "LKR",
    items: quote.items,
  });
});
customerRouter.get("/wishlist", authenticated, async (req, res) =>
  res.json(
    await db.wishlistItem.findMany({
      where: { userId: req.session.user!.id, product: { active: true } },
      include: { product: { include: productInclude } },
      orderBy: { createdAt: "desc" },
    }),
  ),
);
customerRouter.put("/wishlist/:productId", authenticated, async (req, res) => {
  const productId = String(req.params.productId);
  assert(
    await db.product.findFirst({ where: { id: productId, active: true } }),
    404,
    "Product not found.",
  );
  await db.wishlistItem.upsert({
    where: { userId_productId: { userId: req.session.user!.id, productId } },
    create: { userId: req.session.user!.id, productId },
    update: {},
  });
  res.json({ saved: true });
});
customerRouter.delete(
  "/wishlist/:productId",
  authenticated,
  async (req, res) => {
    await db.wishlistItem.deleteMany({
      where: {
        userId: req.session.user!.id,
        productId: String(req.params.productId),
      },
    });
    res.json({ saved: false });
  },
);
customerRouter.get("/addresses", authenticated, async (req, res) =>
  res.json(
    await db.address.findMany({
      where: { userId: req.session.user!.id },
      select: addressSelect,
    }),
  ),
);
customerRouter.post("/addresses", authenticated, async (req, res) => {
  const input = addressSchema.parse(req.body);
  assert(
    (await db.address.count({ where: { userId: req.session.user!.id } })) < 10,
    400,
    "You can save up to ten addresses.",
  );
  res.status(201).json(
    await db.address.create({
      data: { ...input, userId: req.session.user!.id },
      select: addressSelect,
    }),
  );
});
customerRouter.put("/addresses/:id", authenticated, async (req, res) => {
  const input = addressSchema.parse(req.body);
  const result = await db.address.updateMany({
    where: { id: String(req.params.id), userId: req.session.user!.id },
    data: input,
  });
  assert(result.count, 404, "Address not found.");
  res.json({ updated: true });
});
customerRouter.delete("/addresses/:id", authenticated, async (req, res) => {
  await db.address.deleteMany({
    where: { id: String(req.params.id), userId: req.session.user!.id },
  });
  res.json({ deleted: true });
});
const checkoutLimit = rateLimit({
  windowMs: 60000,
  limit: env.NODE_ENV === "test" ? 1000 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait a minute before trying checkout again." },
});
customerRouter.post(
  "/checkout",
  authenticated,
  verified,
  checkoutLimit,
  async (req, res) => {
    const input = checkoutSchema.parse(req.body);
    const key = z.string().uuid().parse(req.get("idempotency-key"));
    const order = await createOrder(
      req.session.user!.id,
      req.session.cartId,
      req.session.user!.email,
      input,
      key,
    );
    const canPay =
      order.payment?.provider === "PAYHERE" &&
      paymentConfigured &&
      order.status === "PENDING_PAYMENT" &&
      order.expiresAt &&
      order.expiresAt > new Date() &&
      !order.stockReleased;
    res
      .status(201)
      .json({ order, payment: canPay ? paymentFields(order) : null });
  },
);
// Read-only recovery after a lost checkout response, always scoped to its owner.
customerRouter.get(
  "/checkout/attempts/:key",
  authenticated,
  async (req, res) => {
    const key = z.string().uuid().parse(req.params.key);
    const order = await db.order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: req.session.user!.id,
          idempotencyKey: key,
        },
      },
      include: orderInclude,
    });
    res.json({ order });
  },
);
customerRouter.get("/orders", authenticated, async (req, res) =>
  res.json(
    await db.order.findMany({
      where: { userId: req.session.user!.id },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ),
);
customerRouter.get("/orders/:id", authenticated, async (req, res) => {
  const order = await db.order.findFirst({
    where: {
      id: String(req.params.id),
      ...(req.session.user!.role === "ADMIN"
        ? {}
        : { userId: req.session.user!.id }),
    },
    include: orderInclude,
  });
  assert(order, 404, "Order not found.");
  res.json(order);
});
customerRouter.post("/orders/:id/payment", authenticated, async (req, res) => {
  const order = await db.order.findFirst({
    where: { id: String(req.params.id), userId: req.session.user!.id },
    include: orderInclude,
  });
  assert(order, 404, "Order not found.");
  res.json(paymentFields(order));
});
customerRouter.post("/orders/:id/cancel", authenticated, async (req, res) => {
  await serializable(async (tx) => {
    const order = await tx.order.findFirst({
      where: { id: String(req.params.id), userId: req.session.user!.id },
      include: { payment: true },
    });
    assert(order, 404, "Order not found.");
    assert(
      order.status === "PENDING_PAYMENT" ||
        (order.payment?.provider === "COD" &&
          order.payment.status === "PENDING_COLLECTION" &&
          order.status === "CONFIRMED"),
      409,
      "Contact customer care to cancel an order that is paid or already being prepared.",
    );
    await releaseReservation(tx, order.id);
    await tx.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED" },
    });
    await tx.payment.update({
      where: { orderId: order.id },
      data: { status: "FAILED" },
    });
  });
  res.json({ message: "Order cancelled. Reserved stock has been released." });
});
customerRouter.post(
  "/products/:id/reviews",
  authenticated,
  verified,
  async (req, res) => {
    const input = reviewSchema.parse(req.body);
    const productId = String(req.params.id);
    const purchased = await db.orderItem.findFirst({
      where: {
        variant: { productId },
        order: {
          userId: req.session.user!.id,
          status: "DELIVERED",
          payment: { status: "PAID" },
        },
      },
    });
    assert(
      purchased,
      403,
      "Reviews are available after a verified purchase is delivered.",
    );
    await db.review.upsert({
      where: { userId_productId: { userId: req.session.user!.id, productId } },
      create: { ...input, userId: req.session.user!.id, productId },
      update: { ...input, approved: false },
    });
    res
      .status(201)
      .json({ message: "Thank you. Your review is awaiting moderation." });
  },
);
const formLimit = rateLimit({
  windowMs: 3600000,
  limit: env.NODE_ENV === "test" ? 100 : 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please try again later." },
});
customerRouter.post("/newsletter", formLimit, async (req, res) => {
  const { email } = z
    .object({ email: emailSchema, consent: z.literal(true) })
    .strict()
    .parse(req.body);
  const token = randomToken();
  await db.$transaction(async (tx) => {
    const current = await tx.newsletterSubscription.findUnique({
      where: { email },
    });
    if (current?.confirmedAt && !current.unsubscribedAt) return;
    await tx.newsletterSubscription.upsert({
      where: { email },
      create: {
        email,
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 86400000),
      },
      update: {
        tokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 86400000),
        confirmedAt: null,
        unsubscribedAt: null,
      },
    });
    await queueEmail(
      tx,
      email,
      "Confirm your COZZY subscription",
      `Confirm that you want to receive COZZY news:\n${env.APP_ORIGIN}/newsletter/confirm#token=${token}\nIgnore this message if you did not subscribe.`,
    );
  });
  res.json({ message: "Check your email to confirm your subscription." });
});
customerRouter.post("/newsletter/confirm", formLimit, async (req, res) => {
  const { token } = z
    .object({ token: z.string().length(64) })
    .strict()
    .parse(req.body);
  const record = await db.newsletterSubscription.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  assert(
    record &&
      !record.confirmedAt &&
      record.tokenExpiresAt &&
      record.tokenExpiresAt > new Date(),
    400,
    "This subscription link is invalid or expired.",
  );
  const unsubscribe = randomToken();
  await db.$transaction(async (tx) => {
    const consumed = await tx.newsletterSubscription.updateMany({
      where: {
        id: record.id,
        tokenHash: hashToken(token),
        confirmedAt: null,
        tokenExpiresAt: { gt: new Date() },
      },
      data: {
        confirmedAt: new Date(),
        unsubscribedAt: null,
        tokenHash: hashToken(unsubscribe),
        tokenExpiresAt: null,
      },
    });
    assert(
      consumed.count === 1,
      400,
      "This subscription link has already been used.",
    );
    await queueEmail(
      tx,
      record.email,
      "Welcome to COZZY updates",
      `Your subscription is confirmed.\nUnsubscribe at any time:\n${env.APP_ORIGIN}/newsletter/unsubscribe#token=${unsubscribe}`,
    );
  });
  res.json({ message: "Your subscription is confirmed." });
});
customerRouter.post("/newsletter/unsubscribe", formLimit, async (req, res) => {
  const { token } = z
    .object({ token: z.string().length(64) })
    .strict()
    .parse(req.body);
  await db.newsletterSubscription.updateMany({
    where: { tokenHash: hashToken(token), confirmedAt: { not: null } },
    data: { unsubscribedAt: new Date(), tokenHash: null, tokenExpiresAt: null },
  });
  res.json({ message: "You have been unsubscribed." });
});
customerRouter.post("/contact", formLimit, async (req, res) => {
  const input = z
    .object({
      name: z.string().trim().min(2).max(100),
      email: emailSchema,
      body: z.string().trim().min(10).max(4000),
    })
    .strict()
    .parse(req.body);
  await db.contactMessage.create({ data: input });
  res
    .status(201)
    .json({ message: "Your message has been received by customer care." });
});

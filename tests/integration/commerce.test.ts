import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";
import { createApp, errorHandler } from "../../backend/src/app.js";
import { db } from "../../backend/src/config/db.js";
import { env } from "../../backend/src/config/env.js";
import { hashToken } from "../../backend/src/utils/crypto.js";
import {
  notificationSignature,
  checkoutHash,
} from "../../backend/src/services/payhere.js";
import { expireOrders } from "../../backend/src/services/orders.js";
assert.equal(process.env.NODE_ENV, "test");
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/cozzy_test_[a-f0-9]{16}$/,
);
const app = createApp();
app.use(errorHandler);
const password = "test customer password 123";
const passwordHash = await bcrypt.hash(password, 12);
const address = {
  name: "Test Customer",
  phone: "0771234567",
  line1: "12 Test Road",
  line2: "",
  city: "Colombo",
  postalCode: "00100",
  country: "LK",
};
const input = {
  address,
  shippingMethodId: "standard",
  couponCode: "",
  paymentMethod: "PAYHERE",
  notes: "",
};
async function visitor() {
  const agent = request.agent(app);
  const response = await agent.get("/api/v1/auth/session").expect(200);
  let csrf = response.body.csrfToken;
  return {
    agent,
    get csrf() {
      return csrf;
    },
    set csrf(v: string) {
      csrf = v;
    },
    call(
      method: string,
      path: string,
      body: unknown = {},
      headers: Record<string, string> = {},
    ) {
      return (agent as any)
        [method]("/api/v1" + path)
        .set("Origin", env.APP_ORIGIN)
        .set("X-CSRF-Token", csrf)
        .set(headers)
        .send(body);
    },
  };
}
async function customer(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
  const user = await db.user.create({
    data: {
      name: "Test Customer",
      email: `${randomUUID()}@example.test`,
      passwordHash,
      verifiedAt: new Date(),
      role,
    },
  });
  const v = await visitor();
  const result = await v
    .call("post", "/auth/login", { email: user.email, password })
    .expect(200);
  v.csrf = result.body.csrfToken;
  return {
    ...v,
    csrf: result.body.csrfToken,
    user,
    call(
      method: string,
      path: string,
      body: unknown = {},
      headers: Record<string, string> = {},
    ) {
      return (v.agent as any)
        [method]("/api/v1" + path)
        .set("Origin", env.APP_ORIGIN)
        .set("X-CSRF-Token", result.body.csrfToken)
        .set(headers)
        .send(body);
    },
  };
}
const variants = await db.productVariant.findMany({
  include: { product: true },
  take: 20,
});
const variant = variants[0];
async function add(
  c: Awaited<ReturnType<typeof visitor>>,
  id = variant.id,
  quantity = 1,
) {
  return c.call("put", "/cart/items", { variantId: id, quantity }).expect(200);
}
function checkout(
  c: Awaited<ReturnType<typeof visitor>>,
  key = randomUUID(),
  overrides = {},
) {
  return c.call(
    "post",
    "/checkout",
    { ...input, ...overrides },
    { "Idempotency-Key": key },
  );
}
function webhook(
  order: { id: string; total: number },
  code = "2",
  paymentId = `payment-${order.id}`,
) {
  const amount = (order.total / 100).toFixed(2);
  return {
    merchant_id: env.PAYHERE_MERCHANT_ID,
    order_id: order.id,
    payment_id: paymentId,
    payhere_amount: amount,
    payhere_currency: "LKR",
    status_code: code,
    md5sig: notificationSignature(
      env.PAYHERE_MERCHANT_ID,
      order.id,
      amount,
      "LKR",
      code,
      env.PAYHERE_MERCHANT_SECRET,
    ),
  };
}
function notify(body: unknown) {
  return request(app)
    .post("/api/v1/payments/payhere/notify")
    .type("form")
    .send(body);
}
after(async () => {
  await db.$disconnect();
});
test("database-backed commerce and security", async (t) => {
  await t.test(
    "catalog filters, pagination, and product detail use imported PostgreSQL data",
    async () => {
      const res = await request(app)
        .get("/api/v1/products?gender=women&limit=3")
        .expect(200);
      assert.equal(res.body.items.length, 3);
      assert.ok(res.body.items.every((p: any) => p.gender === "women"));
      assert.ok(res.body.total > 3);
      const detail = await request(app)
        .get("/api/v1/products/" + variant.product.slug)
        .expect(200);
      assert.equal(detail.body.price, variant.product.price);
      await request(app).get("/api/v1/products?limit=1000").expect(400);
      await request(app).get("/api/v1/products/not-real").expect(404);
    },
  );
  await t.test(
    "CSRF and Origin protect anonymous and authenticated mutations",
    async () => {
      const v = await visitor();
      await v.agent.post("/api/v1/contact").send({}).expect(403);
      await v.agent
        .post("/api/v1/contact")
        .set("Origin", "https://evil.test")
        .set("X-CSRF-Token", v.csrf)
        .send({})
        .expect(403);
      await v.agent
        .post("/api/v1/contact")
        .set("Origin", env.APP_ORIGIN)
        .set("X-CSRF-Token", "bad")
        .send({})
        .expect(403);
    },
  );
  await t.test(
    "registration hashes passwords, verification is one time, and sessions rotate on login",
    async () => {
      const v = await visitor();
      const email = `register-${randomUUID()}@example.test`;
      await v
        .call("post", "/auth/register", {
          name: "Registered Customer",
          email,
          password,
          consent: true,
        })
        .expect(201);
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      assert.notEqual(user.passwordHash, password);
      assert.equal(await bcrypt.compare(password, user.passwordHash), true);
      const job = await db.emailJob.findFirstOrThrow({
        where: { to: email, subject: { contains: "Verify" } },
      });
      const token = job.text.match(/token=([a-f0-9]{64})/)![1];
      assert.equal(
        (await db.accountToken.findFirstOrThrow({ where: { userId: user.id } }))
          .tokenHash,
        hashToken(token),
      );
      await v.call("post", "/auth/verify", { token }).expect(200);
      await v.call("post", "/auth/verify", { token }).expect(400);
      const before = await db.session.findMany({
        where: {
          cartId: (
            await db.session.findFirstOrThrow({ where: { csrfToken: v.csrf } })
          ).cartId,
        },
      });
      const login = await v
        .call("post", "/auth/login", { email, password })
        .expect(200);
      assert.equal(login.body.user.verified, true);
      assert.notEqual(login.body.csrfToken, v.csrf);
      assert.equal(await db.session.count({ where: { id: before[0].id } }), 0);
      assert.ok(login.headers["set-cookie"][0].includes("HttpOnly"));
    },
  );
  await t.test(
    "forgot password is generic; reset revokes sessions and consumes its token",
    async () => {
      const c = await customer();
      const response = await c
        .call("post", "/auth/forgot", { email: c.user.email })
        .expect(200);
      const missing = await c
        .call("post", "/auth/forgot", { email: "missing@example.test" })
        .expect(200);
      assert.equal(response.body.message, missing.body.message);
      const job = await db.emailJob.findFirstOrThrow({
        where: { to: c.user.email, subject: { contains: "Reset" } },
      });
      const token = job.text.match(/token=([a-f0-9]{64})/)![1];
      const v = await visitor();
      await v
        .call("post", "/auth/reset", {
          token,
          password: "new secure password 456",
        })
        .expect(200);
      await c.agent.get("/api/v1/orders").expect(401);
      await v.call("post", "/auth/reset", { token, password }).expect(400);
    },
  );
  await t.test(
    "guest cart persists and merges on login; prices cannot be injected",
    async () => {
      const v = await visitor();
      await add(v, variant.id, 2);
      assert.equal(
        (await v.agent.get("/api/v1/cart").expect(200)).body.items[0].quantity,
        2,
      );
      const user = await db.user.create({
        data: {
          name: "Cart Customer",
          email: `cart-${randomUUID()}@example.test`,
          passwordHash,
          verifiedAt: new Date(),
        },
      });
      const result = await v
        .call("post", "/auth/login", { email: user.email, password })
        .expect(200);
      v.csrf = result.body.csrfToken;
      const cart = await v.agent.get("/api/v1/cart").expect(200);
      assert.equal(cart.body.items[0].quantity, 2);
      assert.equal(cart.body.subtotal, variant.product.price * 2);
      await v
        .call("put", "/cart/items", {
          variantId: variant.id,
          quantity: 1,
          price: 1,
        })
        .expect(400);
      await v
        .call("put", "/cart/items", { variantId: variant.id, quantity: 11 })
        .expect(400);
      await v
        .call("delete", "/cart/items/" + cart.body.items[0].id)
        .expect(200);
    },
  );
  await t.test(
    "customer cannot access admin API or another customer order/address",
    async () => {
      const c = await customer();
      await c.agent.get("/api/v1/admin/overview").expect(403);
      await c.call("post", "/admin/products", {}).expect(403);
      const a = await c.call("post", "/addresses", address).expect(201);
      const other = await customer();
      await other.call("put", "/addresses/" + a.body.id, address).expect(404);
      await add(c);
      const order = await checkout(c).expect(201);
      await other.agent
        .get("/api/v1/orders/" + order.body.order.id)
        .expect(404);
      await c
        .call("post", "/orders/" + order.body.order.id + "/cancel")
        .expect(200);
    },
  );
  await t.test("unverified accounts cannot checkout", async () => {
    const c = await customer();
    await db.user.update({
      where: { id: c.user.id },
      data: { verifiedAt: null },
    });
    await add(c);
    await checkout(c).expect(403);
  });
  await t.test(
    "admin product CRUD validates variants and archives safely",
    async () => {
      const admin = await customer("ADMIN");
      const body = {
        name: "Integration shirt",
        slug: "integration-shirt",
        description: "A product used by integration tests.",
        gender: "men",
        categoryId: variant.product.categoryId,
        price: 125000,
        images: [{ url: "/media/hero.webp", alt: "Test shirt" }],
        variants: [
          { sku: "TEST-SHIRT-M", size: "M", color: "Black", stock: 3 },
        ],
      };
      const created = await admin
        .call("post", "/admin/products", body)
        .expect(201);
      assert.equal(created.body.variants[0].inventory.stock, 3);
      await admin
        .call("put", "/admin/products/" + created.body.id, {
          ...body,
          price: 150000,
        })
        .expect(200);
      await admin
        .call("delete", "/admin/products/" + created.body.id)
        .expect(200);
      await request(app).get("/api/v1/products/integration-shirt").expect(404);
      assert.ok(
        (await db.auditLog.count({ where: { targetId: created.body.id } })) >=
          3,
      );
    },
  );
  await t.test(
    "quote and checkout calculate authoritative totals and use idempotency",
    async () => {
      const c = await customer();
      await add(c);
      await checkout(c, randomUUID(), { total: 1 }).expect(400);
      const key = randomUUID();
      const billing = {
        billingAddress: {
          ...address,
          name: "Billing Customer",
          line1: "42 Billing Road",
          city: "Kandy",
        },
      };
      const order = await checkout(c, key, billing).expect(201);
      assert.equal(order.body.payment.fields.address, "42 Billing Road");
      assert.equal(order.body.payment.fields.delivery_address, address.line1);
      assert.equal(order.body.order.total, variant.product.price + 50000);
      assert.equal(
        order.body.payment.fields.amount,
        ((variant.product.price + 50000) / 100).toFixed(2),
      );
      assert.equal(
        order.body.payment.fields.hash,
        checkoutHash(
          env.PAYHERE_MERCHANT_ID,
          order.body.order.id,
          order.body.payment.fields.amount,
          "LKR",
          env.PAYHERE_MERCHANT_SECRET,
        ),
      );
      const retry = await checkout(c, key, billing).expect(201);
      assert.equal(retry.body.order.id, order.body.order.id);
      assert.equal(await db.order.count({ where: { userId: c.user.id } }), 1);
      await checkout(c, key, { ...billing, notes: "changed" }).expect(409);
      await c
        .call("post", "/orders/" + order.body.order.id + "/cancel")
        .expect(200);
    },
  );
  await t.test(
    "verified success commits inventory once and duplicate/older failure events cannot reverse it",
    async () => {
      const c = await customer();
      const stock = (
        await db.inventory.findUniqueOrThrow({
          where: { variantId: variant.id },
        })
      ).stock;
      await add(c);
      const result = await checkout(c).expect(201);
      const o = result.body.order;
      await notify({ ...webhook(o), md5sig: "0".repeat(32) }).expect(400);
      const wrong = webhook({ ...o, total: o.total + 100 });
      await notify(wrong).expect(400);
      // An admin may change merchandising URLs while a hosted payment is open.
      await db.product.update({
        where: { id: variant.productId },
        data: { slug: variant.product.slug + "-renamed" },
      });
      await notify(webhook(o)).expect(200);
      await notify(webhook(o)).expect(200);
      await notify(webhook(o, "-2")).expect(200);
      const saved = await db.order.findUniqueOrThrow({
        where: { id: o.id },
        include: { payment: true },
      });
      assert.equal(saved.status, "CONFIRMED");
      assert.equal(saved.payment?.status, "PAID");
      const inv = await db.inventory.findUniqueOrThrow({
        where: { variantId: variant.id },
      });
      assert.equal(inv.stock, stock - 1);
      assert.equal(inv.reserved, 0);
    },
  );
  await t.test(
    "failed payments restore stock once; late success requires reconciliation",
    async () => {
      const c = await customer();
      const stock = (
        await db.inventory.findUniqueOrThrow({
          where: { variantId: variant.id },
        })
      ).stock;
      await add(c);
      const result = await checkout(c).expect(201);
      const o = result.body.order;
      await notify(webhook(o, "-2")).expect(200);
      await notify(webhook(o, "-2")).expect(200);
      assert.equal(
        (
          await db.inventory.findUniqueOrThrow({
            where: { variantId: variant.id },
          })
        ).stock,
        stock,
      );
      await notify(webhook(o)).expect(200);
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: o.id } })).status,
        "PAYMENT_REVIEW",
      );
      assert.equal(
        (
          await db.inventory.findUniqueOrThrow({
            where: { variantId: variant.id },
          })
        ).stock,
        stock,
      );
    },
  );
  await t.test(
    "coupon limits are enforced and failed reservations release usage",
    async () => {
      const coupon = await db.coupon.create({
        data: {
          code: "INTEGRATION10",
          percent: 10,
          minimum: 10000,
          maximumDiscount: 100000,
          maxUses: 1,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      const c = await customer();
      await add(c);
      const quote = await c
        .call("post", "/cart/quote", {
          shippingMethodId: "standard",
          couponCode: coupon.code,
        })
        .expect(200);
      assert.equal(
        quote.body.discount,
        Math.round(variant.product.price * 0.1),
      );
      const result = await checkout(c, randomUUID(), {
        couponCode: coupon.code,
      }).expect(201);
      const other = await customer();
      await add(other);
      await checkout(other, randomUUID(), { couponCode: coupon.code }).expect(
        400,
      );
      await notify(webhook(result.body.order, "-1")).expect(200);
      assert.equal(
        (await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } })).uses,
        0,
      );
    },
  );
  await t.test(
    "simultaneous checkouts cannot oversell the last unit",
    async () => {
      const v = variants[10];
      await db.inventory.update({
        where: { variantId: v.id },
        data: { stock: 1 },
      });
      const [a, b] = await Promise.all([customer(), customer()]);
      await Promise.all([add(a, v.id), add(b, v.id)]);
      const results = await Promise.all([checkout(a), checkout(b)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      const inventory = await db.inventory.findUniqueOrThrow({
        where: { variantId: v.id },
      });
      assert.equal(inventory.stock, 0);
      assert.equal(inventory.reserved, 1);
      const winner = results.find((r) => r.status === 201)!.body.order;
      await notify(webhook(winner, "-2")).expect(200);
      assert.equal(
        (await db.inventory.findUniqueOrThrow({ where: { variantId: v.id } }))
          .stock,
        1,
      );
    },
  );
  await t.test(
    "expired reservations release inventory and cannot be paid again normally",
    async () => {
      const c = await customer();
      await add(c);
      const result = await checkout(c).expect(201);
      await db.order.update({
        where: { id: result.body.order.id },
        data: { expiresAt: new Date(0) },
      });
      await expireOrders();
      const o = await db.order.findUniqueOrThrow({
        where: { id: result.body.order.id },
        include: { payment: true },
      });
      assert.equal(o.stockReleased, true);
      assert.equal(o.payment?.status, "EXPIRED");
      await c.call("post", "/orders/" + o.id + "/payment").expect(409);
    },
  );
  await t.test(
    "fulfillment transitions and refunds require valid state and provider reference",
    async () => {
      const c = await customer();
      const admin = await customer("ADMIN");
      await add(c);
      const result = await checkout(c).expect(201);
      const o = result.body.order;
      await notify(webhook(o)).expect(200);
      await admin
        .call("post", "/admin/orders/" + o.id + "/collect")
        .expect(409);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "DELIVERED" })
        .expect(409);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "PROCESSING" })
        .expect(200);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "SHIPPED" })
        .expect(400);
      await admin
        .call("patch", "/admin/orders/" + o.id, {
          status: "SHIPPED",
          tracking: "TEST-TRACKING",
        })
        .expect(200);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "DELIVERED" })
        .expect(200);
      await c
        .call("post", "/products/" + variant.productId + "/reviews", {
          rating: 5,
          title: "Good fit",
          body: "A detailed verified purchase review.",
        })
        .expect(201);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "REFUND_PENDING" })
        .expect(200);
      await admin
        .call("patch", "/admin/orders/" + o.id, { status: "REFUNDED" })
        .expect(400);
      await admin
        .call("patch", "/admin/orders/" + o.id, {
          status: "REFUNDED",
          refundReference: "TEST-REFUND-REFERENCE",
        })
        .expect(200);
    },
  );
  await t.test(
    "signed PayHere notifications cannot change a COD order",
    async () => {
      const c = await customer();
      await add(c);
      const order = (
        await checkout(c, randomUUID(), { paymentMethod: "COD" }).expect(201)
      ).body.order;
      await notify(webhook(order)).expect(400);
      const saved = await db.payment.findUniqueOrThrow({
        where: { orderId: order.id },
      });
      assert.equal(saved.provider, "COD");
      assert.equal(saved.status, "PENDING_COLLECTION");
      assert.equal(
        await db.paymentEvent.count({ where: { paymentId: saved.id } }),
        0,
      );
      await c.call("post", "/orders/" + order.id + "/payment").expect(409);
    },
  );
  await t.test(
    "newsletter confirmation, unsubscribe, contact and review moderation persist",
    async () => {
      const v = await visitor();
      const email = `newsletter-${randomUUID()}@example.test`;
      await v.call("post", "/newsletter", { email, consent: true }).expect(200);
      const job = await db.emailJob.findFirstOrThrow({ where: { to: email } });
      const token = job.text.match(/token=([a-f0-9]{64})/)![1];
      await v.call("post", "/newsletter/confirm", { token }).expect(200);
      await v.call("post", "/newsletter/confirm", { token }).expect(400);
      const welcome = await db.emailJob.findFirstOrThrow({
        where: { to: email, subject: { contains: "Welcome" } },
      });
      await v
        .call("post", "/newsletter/unsubscribe", {
          token: welcome.text.match(/token=([a-f0-9]{64})/)![1],
        })
        .expect(200);
      assert.ok(
        (
          await db.newsletterSubscription.findUniqueOrThrow({
            where: { email },
          })
        ).unsubscribedAt,
      );
      await v
        .call("post", "/contact", {
          name: "Contact Customer",
          email,
          body: "Please help with the size of this piece.",
        })
        .expect(201);
      assert.equal(await db.contactMessage.count({ where: { email } }), 1);
      const review = await db.review.findFirstOrThrow();
      const admin = await customer("ADMIN");
      await admin
        .call("patch", "/admin/reviews/" + review.id, { approved: true })
        .expect(200);
      assert.equal(
        (await db.review.findUniqueOrThrow({ where: { id: review.id } }))
          .approved,
        true,
      );
    },
  );
  await t.test(
    "database constraints prevent negative stock and account disabling revokes sessions",
    async () => {
      await assert.rejects(() =>
        db.inventory.update({
          where: { variantId: variant.id },
          data: { stock: -1 },
        }),
      );
      const c = await customer();
      const admin = await customer("ADMIN");
      await admin
        .call("patch", "/admin/customers/" + c.user.id, { active: false })
        .expect(200);
      await c.agent.get("/api/v1/orders").expect(401);
    },
  );
});

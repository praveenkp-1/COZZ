import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import bcrypt from "bcryptjs";

assert.equal(process.env.NODE_ENV, "test", "COD fixtures require test mode.");
assert.match(
  new URL(process.env.DATABASE_URL!).pathname,
  /^\/cozzy_test_[a-f0-9]{16}$/,
  "COD fixtures require an isolated test database.",
);
// This file runs in its own node:test process. Exercise real COD with no gateway.
process.env.PAYHERE_MERCHANT_ID = "";
process.env.PAYHERE_MERCHANT_SECRET = "";
const { createApp, errorHandler } = await import("../../backend/src/app.js");
const { db } = await import("../../backend/src/config/db.js");
const { env } = await import("../../backend/src/config/env.js");
const { expireOrders } = await import("../../backend/src/services/orders.js");
const app = createApp();
app.use(errorHandler);
after(() => db.$disconnect());
const password = "COD integration password 123";
const passwordHash = await bcrypt.hash(password, 12);
const address = {
  name: "COD Customer",
  phone: "0771234567",
  line1: "12 Delivery Road",
  line2: "",
  city: "Colombo",
  postalCode: "00100",
  country: "LK",
};
const input = {
  address,
  shippingMethodId: "standard",
  paymentMethod: "COD",
  couponCode: "",
  notes: "",
};
async function visitor() {
  const agent = request.agent(app);
  const session = await agent.get("/api/v1/auth/session").expect(200);
  let csrf = session.body.csrfToken;
  return {
    agent,
    setCsrf(value: string) {
      csrf = value;
    },
    call(method: string, path: string, body: unknown = {}, headers = {}) {
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
      name: "COD " + role,
      email: randomUUID() + "@example.test",
      passwordHash,
      verifiedAt: new Date(),
      role,
    },
  });
  const client = await visitor();
  const login = await client
    .call("post", "/auth/login", { email: user.email, password })
    .expect(200);
  client.setCsrf(login.body.csrfToken);
  return { ...client, user };
}
async function variant(stock = 5) {
  const category = await db.category.findFirstOrThrow();
  const id = randomUUID();
  const product = await db.product.create({
    data: {
      name: "Isolated COD test shirt",
      slug: "cod-test-" + id,
      description: "Used only in an isolated test database.",
      gender: "men",
      categoryId: category.id,
      price: 100000,
      images: {
        create: {
          url: "/media/hero.webp",
          alt: "Isolated fixture",
          position: 0,
        },
      },
      variants: {
        create: {
          sku: "COD-" + id,
          size: "M",
          color: "Black",
          price: 120000,
          inventory: { create: { stock } },
        },
      },
    },
    include: { variants: true },
  });
  return product.variants[0];
}
async function add(
  c: Awaited<ReturnType<typeof visitor>>,
  id: string,
  quantity = 1,
) {
  await c.call("put", "/cart/items", { variantId: id, quantity }).expect(200);
}
function checkout(
  c: Awaited<ReturnType<typeof visitor>>,
  overrides = {},
  key = randomUUID(),
) {
  return c.call(
    "post",
    "/checkout",
    { ...input, ...overrides },
    { "Idempotency-Key": key },
  );
}
const inventory = (id: string) =>
  db.inventory.findUniqueOrThrow({ where: { variantId: id } });
async function ship(admin: Awaited<ReturnType<typeof visitor>>, id: string) {
  await admin
    .call("patch", "/admin/orders/" + id, { status: "PROCESSING" })
    .expect(200);
  await admin
    .call("patch", "/admin/orders/" + id, {
      status: "SHIPPED",
      tracking: "COD-TRACKING",
    })
    .expect(200);
}

test("COD commerce without PayHere credentials", async (t) => {
  await t.test(
    "creates a confirmed unpaid PostgreSQL order and clears the cart only on success",
    async () => {
      assert.equal(
        (await request(app).get("/api/v1/store").expect(200)).body
          .paymentEnabled,
        false,
      );
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      const result = await checkout(c).expect(201);
      const order = result.body.order;
      assert.match(order.number, /^CZ-\d{8}-[A-F0-9]{8}$/);
      assert.equal(order.status, "CONFIRMED");
      assert.equal(order.expiresAt, null);
      assert.equal(order.payment.provider, "COD");
      assert.equal(order.payment.status, "PENDING_COLLECTION");
      assert.equal(order.payment.collectedAt, null);
      assert.equal(order.payment.collectedById, null);
      assert.equal(order.payment.providerPaymentId, null);
      assert.equal(order.currency, "LKR");
      assert.equal(order.total, 170000);
      assert.equal(result.body.payment, null);
      assert.equal(
        (await db.order.findUniqueOrThrow({ where: { id: order.id } })).number,
        order.number,
      );
      assert.equal(
        (await c.agent.get("/api/v1/cart").expect(200)).body.items.length,
        0,
      );
      assert.equal((await inventory(v.id)).stock, 4);
      assert.equal((await inventory(v.id)).reserved, 1);
      await c.call("post", "/orders/" + order.id + "/payment").expect(409);
      const history = await c.agent.get("/api/v1/orders").expect(200);
      assert.equal(history.body[0].payment.status, "PENDING_COLLECTION");
      const email = await db.emailJob.findFirstOrThrow({
        where: { to: c.user.email, subject: { contains: "Order confirmed" } },
      });
      assert.match(email.text, /No payment has been collected/);
    },
  );
  await t.test(
    "unconfigured PayHere rejects checkout without consuming cart or inventory",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      const result = await checkout(c, { paymentMethod: "PAYHERE" }).expect(
        503,
      );
      assert.equal(result.body.code, "PAYMENT_UNCONFIGURED");
      assert.equal(await db.order.count({ where: { userId: c.user.id } }), 0);
      assert.equal((await inventory(v.id)).stock, 5);
      assert.equal(
        (await c.agent.get("/api/v1/cart").expect(200)).body.items.length,
        1,
      );
    },
  );
  await t.test(
    "insufficient stock rolls back checkout and a safe retry can succeed",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id, 2);
      await db.inventory.update({
        where: { variantId: v.id },
        data: { stock: 1 },
      });
      const key = randomUUID();
      await checkout(c, {}, key).expect(409);
      assert.equal(await db.order.count({ where: { userId: c.user.id } }), 0);
      assert.equal((await inventory(v.id)).reserved, 0);
      assert.equal(
        (await c.agent.get("/api/v1/cart").expect(200)).body.items[0].quantity,
        2,
      );
      await db.inventory.update({
        where: { variantId: v.id },
        data: { stock: 2 },
      });
      await checkout(c, {}, key).expect(201);
      assert.equal((await inventory(v.id)).stock, 0);
      assert.equal((await inventory(v.id)).reserved, 2);
    },
  );
  await t.test(
    "simultaneous duplicate requests and lost-response retries create one order and one reservation",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      const key = randomUUID();
      const results = await Promise.all([
        checkout(c, {}, key),
        checkout(c, {}, key),
      ]);
      assert.deepEqual(
        results.map((r) => r.status),
        [201, 201],
      );
      assert.equal(results[0].body.order.id, results[1].body.order.id);
      const retry = await checkout(c, {}, key).expect(201);
      assert.equal(retry.body.order.id, results[0].body.order.id);
      assert.equal(await db.order.count({ where: { userId: c.user.id } }), 1);
      assert.equal((await inventory(v.id)).stock, 4);
      assert.equal((await inventory(v.id)).reserved, 1);
      assert.equal(
        await db.emailJob.count({
          where: { to: c.user.email, subject: { contains: "Order confirmed" } },
        }),
        1,
      );
      await checkout(c, { notes: "changed" }, key).expect(409);
      await checkout(c, { paymentMethod: "PAYHERE" }, key).expect(409);
      const recovered = await c.agent
        .get("/api/v1/checkout/attempts/" + key)
        .expect(200);
      assert.equal(recovered.body.order.id, retry.body.order.id);
      const other = await customer();
      assert.equal(
        (await other.agent.get("/api/v1/checkout/attempts/" + key).expect(200))
          .body.order,
        null,
      );
      await other.agent
        .get("/api/v1/orders/" + retry.body.order.id)
        .expect(404);
    },
  );
  await t.test(
    "concurrent customers cannot oversell the last unit",
    async () => {
      const v = await variant(1),
        a = await customer(),
        b = await customer();
      await Promise.all([add(a, v.id), add(b, v.id)]);
      const results = await Promise.all([checkout(a), checkout(b)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await inventory(v.id)).stock, 0);
      assert.equal((await inventory(v.id)).reserved, 1);
      assert.equal(
        await db.order.count({
          where: { items: { some: { variantId: v.id } } },
        }),
        1,
      );
    },
  );
  await t.test(
    "checkout racing an admin inventory update preserves nonnegative stock and one reservation at most",
    async () => {
      const v = await variant(1),
        c = await customer(),
        admin = await customer("ADMIN");
      await add(c, v.id);
      const [order, update] = await Promise.all([
        checkout(c),
        admin.call("patch", "/admin/inventory/" + v.id, { stock: 0 }),
      ]);
      assert.equal(update.status, 200);
      assert.ok([201, 409].includes(order.status));
      const saved = await inventory(v.id);
      assert.equal(saved.stock, 0);
      assert.equal(saved.reserved, order.status === 201 ? 1 : 0);
    },
  );
  await t.test(
    "invalid Sri Lankan addresses, inactive delivery, and injected totals never create an order",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      for (const bad of [
        { country: "IN" },
        { phone: "123" },
        { postalCode: "ABC" },
        { line1: "" },
        { city: " " },
      ])
        await checkout(c, { address: { ...address, ...bad } }).expect(400);
      await checkout(c, { total: 1 }).expect(400);
      await checkout(c, { paymentMethod: "FREE" }).expect(400);
      await checkout(c, { shippingMethodId: "not-a-delivery-method" }).expect(
        400,
      );
      const shipping = await db.shippingMethod.create({
        data: {
          name: "Disabled test delivery",
          description: "Isolated test",
          fee: 1,
          active: false,
        },
      });
      await checkout(c, { shippingMethodId: shipping.id }).expect(400);
      assert.equal(await db.order.count({ where: { userId: c.user.id } }), 0);
      assert.equal((await inventory(v.id)).stock, 5);
      assert.equal(
        (await c.agent.get("/api/v1/cart").expect(200)).body.items.length,
        1,
      );
    },
  );
  await t.test(
    "inactive variants and products cannot be purchased from an old cart",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      await db.productVariant.update({
        where: { id: v.id },
        data: { active: false },
      });
      await checkout(c).expect(409);
      await db.productVariant.update({
        where: { id: v.id },
        data: { active: true },
      });
      await db.product.update({
        where: { id: v.productId },
        data: { active: false },
      });
      await checkout(c).expect(409);
      assert.equal((await inventory(v.id)).reserved, 0);
    },
  );
  await t.test(
    "variant prices, capped coupon discounts, shipping and tax are calculated on the server",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id, 2);
      const settings = await db.storeSettings.findUniqueOrThrow({
        where: { id: "store" },
      });
      const shipping = await db.shippingMethod.create({
        data: {
          name: "COD test delivery",
          description: "Isolated test",
          fee: 35000,
          freeAbove: 200000,
        },
      });
      const coupon = await db.coupon.create({
        data: {
          code:
            "COD_" + randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase(),
          percent: 15,
          minimum: 100000,
          maximumDiscount: 30000,
          maxUses: 1,
          expiresAt: new Date(Date.now() + 3600000),
        },
      });
      try {
        await db.storeSettings.update({
          where: { id: "store" },
          data: { taxBasisPoints: 1250 },
        });
        const details = {
          shippingMethodId: shipping.id,
          couponCode: coupon.code,
        };
        const quote = await c.call("post", "/cart/quote", details).expect(200);
        const order = (await checkout(c, details).expect(201)).body.order;
        assert.deepEqual(
          [
            order.subtotal,
            order.discount,
            order.shipping,
            order.tax,
            order.total,
          ],
          [240000, 30000, 0, 26250, 236250],
        );
        assert.equal(order.total, quote.body.total);
        assert.equal(order.items[0].unitPrice, 120000);
        assert.equal(order.payment.amount, order.total);
        const other = await customer();
        await add(other, v.id, 2);
        await checkout(other, details).expect(400);
        await c.call("post", "/orders/" + order.id + "/cancel").expect(200);
        assert.equal(
          (await db.coupon.findUniqueOrThrow({ where: { id: coupon.id } }))
            .uses,
          0,
        );
        assert.equal((await inventory(v.id)).reserved, 0);
      } finally {
        await db.storeSettings.update({
          where: { id: "store" },
          data: { taxBasisPoints: settings.taxBasisPoints },
        });
      }
    },
  );
  await t.test(
    "COD reservations do not expire in the online payment worker",
    async () => {
      const c = await customer(),
        v = await variant();
      await add(c, v.id);
      const order = (await checkout(c).expect(201)).body.order;
      await db.order.update({
        where: { id: order.id },
        data: { expiresAt: new Date(0) },
      });
      await expireOrders();
      const saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true },
      });
      assert.equal(saved.status, "CONFIRMED");
      assert.equal(saved.payment?.status, "PENDING_COLLECTION");
      assert.equal(saved.stockReleased, false);
      assert.equal((await inventory(v.id)).reserved, 1);
    },
  );
  await t.test(
    "customer cancellation restores stock once and disallows later cash collection",
    async () => {
      const c = await customer(),
        v = await variant(),
        admin = await customer("ADMIN");
      await add(c, v.id);
      const order = (await checkout(c).expect(201)).body.order;
      await c.call("post", "/orders/" + order.id + "/cancel").expect(200);
      await c.call("post", "/orders/" + order.id + "/cancel").expect(409);
      await admin
        .call("post", "/admin/orders/" + order.id + "/collect")
        .expect(409);
      assert.equal((await inventory(v.id)).stock, 5);
      assert.equal((await inventory(v.id)).reserved, 0);
    },
  );
  await t.test(
    "racing admin cancellation and shipping cannot release or commit inventory twice",
    async () => {
      const c = await customer(),
        v = await variant(1),
        admin = await customer("ADMIN");
      await add(c, v.id);
      const order = (await checkout(c).expect(201)).body.order;
      await admin
        .call("patch", "/admin/orders/" + order.id, { status: "PROCESSING" })
        .expect(200);
      await c.call("post", "/orders/" + order.id + "/cancel").expect(409);
      const results = await Promise.all([
        admin.call("patch", "/admin/orders/" + order.id, {
          status: "CANCELLED",
        }),
        admin.call("patch", "/admin/orders/" + order.id, {
          status: "SHIPPED",
          tracking: "COD-RACE",
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      const saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      assert.equal((await inventory(v.id)).reserved, 0);
      assert.equal(
        (await inventory(v.id)).stock,
        saved.status === "CANCELLED" ? 1 : 0,
      );
    },
  );
  await t.test(
    "authorized collection records the timestamp, administrator and one audit entry without auto-paying on delivery",
    async () => {
      const c = await customer(),
        v = await variant(),
        admin = await customer("ADMIN"),
        secondAdmin = await customer("ADMIN");
      await add(c, v.id);
      const order = (await checkout(c).expect(201)).body.order;
      await admin
        .call("post", "/admin/orders/" + order.id + "/collect")
        .expect(409);
      await admin
        .call("patch", "/admin/orders/" + order.id, {
          status: "REFUND_PENDING",
        })
        .expect(409);
      await ship(admin, order.id);
      await admin
        .call("patch", "/admin/orders/" + order.id, {
          status: "SHIPPED",
          tracking: "DUPLICATE",
        })
        .expect(409);
      await admin
        .call("patch", "/admin/orders/" + order.id, { status: "DELIVERED" })
        .expect(200);
      let saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true },
      });
      assert.equal(saved.payment?.status, "PENDING_COLLECTION");
      const revenue = (
        await admin.agent.get("/api/v1/admin/overview").expect(200)
      ).body.revenue;
      const receipts = await Promise.all([
        admin.call("post", "/admin/orders/" + order.id + "/collect"),
        secondAdmin.call("post", "/admin/orders/" + order.id + "/collect"),
      ]);
      assert.deepEqual(receipts.map((r) => r.status).sort(), [200, 409]);
      saved = await db.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { payment: true },
      });
      assert.equal(saved.status, "DELIVERED");
      assert.equal(saved.payment?.status, "PAID");
      assert.ok(saved.payment?.collectedAt);
      assert.ok(
        [admin.user.id, secondAdmin.user.id].includes(
          saved.payment!.collectedById!,
        ),
      );
      assert.equal(saved.payment?.providerPaymentId, null);
      assert.equal((await inventory(v.id)).stock, 4);
      assert.equal((await inventory(v.id)).reserved, 0);
      assert.equal(
        (await db.product.findUniqueOrThrow({ where: { id: v.productId } }))
          .salesCount,
        1,
      );
      const audit = await db.auditLog.findMany({
        where: { targetId: order.id, action: "payment.cod.collect" },
      });
      assert.equal(audit.length, 1);
      assert.equal(audit[0].userId, saved.payment?.collectedById);
      assert.equal(
        (await admin.agent.get("/api/v1/admin/overview").expect(200)).body
          .revenue,
        revenue + order.total,
      );
      await admin
        .call("post", "/admin/orders/" + order.id + "/collect")
        .expect(409);
      const list = await admin.agent
        .get("/api/v1/admin/orders?q=" + order.number)
        .expect(200);
      assert.equal(list.body.items[0].payment.collectedBy.name, "COD ADMIN");
      assert.equal(
        (await c.agent.get("/api/v1/orders/" + order.id).expect(200)).body
          .payment.status,
        "PAID",
      );
    },
  );
  await t.test(
    "customer, guest, missing-CSRF and disabled-admin attempts cannot collect cash",
    async () => {
      const c = await customer(),
        v = await variant(),
        admin = await customer("ADMIN"),
        guest = await visitor();
      await add(c, v.id);
      const order = (await checkout(c).expect(201)).body.order;
      await ship(admin, order.id);
      const path = "/admin/orders/" + order.id + "/collect";
      await c.call("post", path).expect(403);
      await guest.call("post", path).expect(403);
      await admin.agent
        .post("/api/v1" + path)
        .send({})
        .expect(403);
      await admin.call("post", path, { amount: 1, status: "PAID" }).expect(400);
      await db.user.update({
        where: { id: admin.user.id },
        data: { active: false },
      });
      await admin.call("post", path).expect(401);
      assert.equal(
        (await db.payment.findUniqueOrThrow({ where: { orderId: order.id } }))
          .status,
        "PENDING_COLLECTION",
      );
      assert.equal(
        await db.auditLog.count({
          where: { targetId: order.id, action: "payment.cod.collect" },
        }),
        0,
      );
    },
  );
});

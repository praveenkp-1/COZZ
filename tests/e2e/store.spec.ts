import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import { Client } from "pg";
import { mkdir, readFile } from "node:fs/promises";
async function query(sql: string, values: unknown[] = []) {
  if (
    process.env.NODE_ENV !== "test" ||
    !/^\/cozzy_test_[a-f0-9]{16}$/.test(
      new URL(process.env.DATABASE_URL!).pathname,
    )
  )
    throw new Error("Browser fixtures require an isolated test database.");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(sql, values)).rows;
  } finally {
    await db.end();
  }
}
test("public pages render product content and metadata on the server", async ({
  page,
  request,
}) => {
  for (const image of [
    "hero-main.webp",
    "women-collection.webp",
    "men-collection.webp",
    "new-arrivals.webp",
  ]) {
    const asset = await request.get("/images/hero/" + image);
    expect(asset.status()).toBe(200);
    expect(asset.headers()["content-type"]).toContain("image/webp");
    expect((await asset.body()).length).toBeGreaterThan(0);
  }
  expect((await request.get("/images/hero/missing-image.webp")).status()).toBe(
    404,
  );
  const products = await (await request.get("/api/v1/products?limit=1")).json();
  const product = products.items[0];
  const response = await request.get("/products/" + product.slug);
  const html = await response.text();
  expect(response.status()).toBe(200);
  expect(html).toContain(product.name.toLowerCase());
  expect(html).toContain("application/ld+json");
  expect(html).toContain('"priceCurrency":"LKR"');
  expect(html).toContain('rel="canonical"');
  expect((await request.get("/sitemap.xml")).status()).toBe(200);
  expect(await (await request.get("/robots.txt")).text()).toContain(
    "Disallow: /admin",
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Shop New Arrivals", exact: true }),
  ).toBeVisible();
  await page.locator(".collection-card").first().scrollIntoViewIfNeeded();
  await page
    .locator(".collection-card img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
    );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await mkdir("test-results/screenshots", { recursive: true });
  await page.screenshot({
    path: "test-results/screenshots/home-desktop.png",
    fullPage: true,
  });
  await page.screenshot({ path: "test-results/screenshots/hero-desktop.png" });
  expect(errors).toEqual([]);
});
test("mobile navigation supports keyboard focus, Escape, and catalog filters", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(menu).toBeFocused();
  await menu.click();
  await dialog.getByRole("link", { name: "Women", exact: true }).click();
  await expect(page).toHaveURL(/gender=women/);
  await expect(page.locator(".product-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/screenshots/catalog-mobile.png",
    fullPage: true,
  });
  await page.goto("/");
  await page.locator(".collection-card").last().scrollIntoViewIfNeeded();
  await page
    .locator(".collection-card img")
    .evaluateAll((images) =>
      Promise.all(images.map((image) => (image as HTMLImageElement).decode())),
    );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "test-results/screenshots/home-mobile.png",
    fullPage: true,
  });
  await page.screenshot({ path: "test-results/screenshots/hero-mobile.png" });
});
test("customer registers, verifies email, buys through PayHere boundary, and sees verified confirmation", async ({
  page,
  request,
}) => {
  const email = `browser-${randomUUID()}@example.test`;
  const password = "browser customer password 123";
  await page.goto("/account/register");
  const form = page.locator("form.auth-form");
  await form.getByLabel("Full name").fill("Browser Customer");
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("checkbox").check();
  await form
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Continue to sign in" }),
  ).toBeVisible();
  const jobs = await query(
    'SELECT id, text FROM "EmailJob" WHERE "to"=$1 ORDER BY "createdAt" DESC LIMIT 1',
    [email],
  );
  const message = jobs[0].text.includes("token=")
    ? jobs[0].text
    : await readFile(".local/mail/" + jobs[0].id + ".txt", "utf8");
  const token = message.match(/token=([a-f0-9]{64})/)?.[1];
  expect(token).toBeTruthy();
  await page.goto("/account/verify#token=" + token);
  await page
    .getByRole("button", { name: "Verify your email", exact: true })
    .click();
  await expect(page.locator("main")).toContainText("verified");
  await page.goto("/account/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Browser." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Addresses", exact: true }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Browser Customer");
  await page.getByLabel("Phone", { exact: true }).fill("0771234567");
  await page
    .getByLabel("Address", { exact: true })
    .fill("12 Browser Test Road");
  await page.getByLabel("City", { exact: true }).fill("Colombo");
  await page.getByLabel("Postal code", { exact: true }).fill("00100");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByRole("status")).toContainText("Address saved");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByLabel("Address", { exact: true })
    .fill("14 Browser Test Road");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.locator(".address-cards")).toContainText(
    "14 Browser Test Road",
  );
  const products = await (await request.get("/api/v1/products?limit=1")).json();
  await page.goto("/products/" + products.items[0].slug);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.locator(".size-buttons button:not([disabled])").first().click();
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added to your bag" }),
  ).toBeVisible();
  await page.goto("/cart");
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await page.reload();
  await expect(page.locator(".cart-item")).toHaveCount(1);
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "Checkout", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Use a saved address").selectOption({ index: 1 });
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
    "14 Browser Test Road",
  );
  await page.locator("main").getByRole("checkbox").last().check();
  await page.getByRole("radio", { name: /PayHere Online Payment/ }).check();
  let fields: URLSearchParams | undefined;
  await page.route("https://sandbox.payhere.lk/pay/checkout", async (route) => {
    fields = new URLSearchParams(route.request().postData() ?? "");
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Payment provider test boundary</h1>",
    });
  });
  await page
    .getByRole("button", { name: "Continue to secure payment" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Payment provider test boundary" }),
  ).toBeVisible();
  expect(fields?.get("currency")).toBe("LKR");
  const orderId = fields!.get("order_id")!;
  const amount = fields!.get("amount")!;
  const merchant = process.env.PAYHERE_MERCHANT_ID!;
  const md5 = (text: string) =>
    createHash("md5").update(text).digest("hex").toUpperCase();
  const signature = md5(
    merchant +
      orderId +
      amount +
      "LKR" +
      "2" +
      md5(process.env.PAYHERE_MERCHANT_SECRET!),
  );
  const response = await request.post("/api/v1/payments/payhere/notify", {
    form: {
      merchant_id: merchant,
      order_id: orderId,
      payment_id: "browser-payment-" + orderId,
      payhere_amount: amount,
      payhere_currency: "LKR",
      status_code: "2",
      md5sig: signature,
    },
  });
  expect(response.status()).toBe(200);
  await page.goto("/orders/" + orderId);
  await expect(
    page.getByRole("heading", { name: "Your order is confirmed." }),
  ).toBeVisible();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/order-confirmed.png",
    fullPage: true,
  });
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Administrator access required." }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/admin/overview")).status()).toBe(403);
});
test("administrator signs in and uses actual inventory and store management screens", async ({
  page,
}) => {
  await page.goto("/account/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser admin password 123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Browser." }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Your store, at a glance.",
  );
  await expect(page.getByText("Revenue", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Products & stock", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Add product" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Store management", exact: true })
    .click();
  await expect(
    page.getByText("Store settings & policies", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/screenshots/admin-store.png",
    fullPage: true,
  });
});

test("COD checkout confirms a real unpaid order without visiting a payment gateway", async ({
  page,
  request,
}) => {
  await page.goto("/account/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("cod@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser COD password 123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, COD." }),
  ).toBeVisible();
  const products = await (await request.get("/api/v1/products?limit=1")).json();
  await page.goto("/products/" + products.items[0].slug);
  await page.locator(".size-buttons button:not([disabled])").first().click();
  await page.getByRole("button", { name: "Add to bag", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Added to your bag" }),
  ).toBeVisible();
  await page.goto("/checkout");
  await page.getByLabel("Phone number", { exact: true }).fill("0771234567");
  await page.getByLabel("Address", { exact: true }).fill("12 COD Browser Road");
  await page.getByLabel("City", { exact: true }).fill("Colombo");
  await page.getByLabel("Postal code", { exact: true }).fill("00100");
  await expect(
    page.getByRole("radio", { name: /Cash on Delivery/ }),
  ).toBeChecked();
  if (!process.env.PAYHERE_MERCHANT_ID) {
    await expect(
      page.getByRole("radio", { name: /PayHere Online Payment/ }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Online payment is currently unavailable/),
    ).toBeVisible();
  }
  await page.locator("main").getByRole("checkbox").last().check();
  // Simulate a dropped response after the real database commit. On reload the
  // persisted checkout key recovers that order; there is no second purchase.
  await page.route("**/api/v1/checkout/attempts/*", (route) =>
    route.abort("failed"),
  );
  await page.route("**/api/v1/checkout", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "Place cash on delivery order" })
    .click();
  await expect(
    page.getByRole("button", { name: "Check previous order status" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/checkout/attempts/*");
  await page.unroute("**/api/v1/checkout");
  await page.reload();
  await page.waitForURL(/\/orders\//);
  await expect(
    page.getByRole("heading", { name: "Your order is confirmed." }),
  ).toBeVisible();
  await expect(
    page.getByText("Awaiting collection", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Amount due on delivery:/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue payment" }),
  ).toHaveCount(0);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const orders = await query(
    'SELECT o.number, o.total, o.status, p.provider, p.status AS "paymentStatus", p."collectedAt" FROM "Order" o JOIN "Payment" p ON p."orderId"=o.id WHERE o.id=$1',
    [id],
  );
  expect(orders[0].provider).toBe("COD");
  expect(orders[0].paymentStatus).toBe("PENDING_COLLECTION");
  expect(orders[0].collectedAt).toBeNull();
  expect(orders[0].status).toBe("CONFIRMED");
  expect(await page.locator(".order-confirmation").textContent()).toContain(
    orders[0].number,
  );
  const count = await query(
    'SELECT count(*)::int AS count FROM "Order" o JOIN "User" u ON u.id=o."userId" WHERE u.email=$1',
    ["cod@example.test"],
  );
  expect(count[0].count).toBe(1);
  await page.goto("/account");
  await expect(page.locator(".order-list-row")).toContainText(
    "Cash on Delivery",
  );
  await expect(page.locator(".order-list-row")).toContainText(
    "Awaiting collection",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto("/account/login");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("admin@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser admin password 123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Browser." }),
  ).toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Order", exact: true })
    .selectOption(id);
  await page
    .getByRole("combobox", { name: "New status", exact: true })
    .selectOption("PROCESSING");
  await page.getByRole("button", { name: "Update order", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Order updated." }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "New status", exact: true })
    .selectOption("SHIPPED");
  await page
    .getByLabel("Tracking reference", { exact: true })
    .fill("BROWSER-COD-TRACKING");
  await page.getByRole("button", { name: "Update order", exact: true }).click();
  const collection = page.getByRole("region", { name: "Cash collection" });
  await expect(
    collection.getByRole("button", { name: "Mark cash as collected" }),
  ).toBeDisabled();
  await collection.getByRole("checkbox").check();
  await collection
    .getByRole("button", { name: "Mark cash as collected" })
    .click();
  await expect(collection).toContainText("Browser Admin");
  await expect(
    collection.getByRole("button", { name: "Mark cash as collected" }),
  ).toHaveCount(0);
  const receipt = await query(
    'SELECT status, "collectedAt", "collectedById" FROM "Payment" WHERE "orderId"=$1',
    [id],
  );
  expect(receipt[0].status).toBe("PAID");
  expect(receipt[0].collectedAt).toBeTruthy();
  expect(receipt[0].collectedById).toBeTruthy();
  const audit = await query(
    'SELECT count(*)::int AS count FROM "AuditLog" WHERE "targetId"=$1 AND action=$2',
    [id, "payment.cod.collect"],
  );
  expect(audit[0].count).toBe(1);
});

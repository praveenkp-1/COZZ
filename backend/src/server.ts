import express from "express";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApp, errorHandler } from "./app.js";
import { env } from "./config/env.js";
import { db } from "./config/db.js";
import { storeData, listProducts, findProduct } from "./routes/catalog.js";
import { deliverMail } from "./services/mail.js";
import { expireOrders } from "./services/orders.js";
import { logger } from "./utils/logger.js";
import { AppError } from "./utils/errors.js";
const root = process.cwd().endsWith("backend")
  ? path.resolve("..")
  : process.cwd();
const clientDir = path.join(root, "frontend/dist");
const app = createApp();
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const json = (value: unknown) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
app.get("/robots.txt", (_req, res) =>
  res
    .type("text")
    .send(
      `User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /orders\nDisallow: /api\nSitemap: ${env.APP_ORIGIN}/sitemap.xml\n`,
    ),
);
app.get("/sitemap.xml", async (_req, res) => {
  const [products, collections] = await Promise.all([
    db.product.findMany({
      where: { active: true },
      select: { slug: true, updatedAt: true },
    }),
    db.collection.findMany({ where: { active: true }, select: { slug: true } }),
  ]);
  const urls = [
    { path: "/", updated: null },
    { path: "/shop", updated: null },
    { path: "/contact", updated: null },
    ...products.map((p) => ({
      path: `/products/${p.slug}`,
      updated: p.updatedAt.toISOString(),
    })),
    ...collections.map((c) => ({
      path: `/shop?collection=${c.slug}`,
      updated: null,
    })),
  ];
  res.setHeader("Cache-Control", "public, max-age=300");
  res
    .type("application/xml")
    .send(
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${escape(env.APP_ORIGIN + u.path)}</loc>${u.updated ? `<lastmod>${u.updated}</lastmod>` : ""}</url>`).join("")}</urlset>`,
    );
});
let built = false;
try {
  await access(path.join(clientDir, "index.html"));
  built = true;
} catch {}
if (built) {
  app.use(
    "/assets",
    express.static(path.join(clientDir, "assets"), {
      maxAge: "1y",
      immutable: true,
    }),
  );
  app.use(
    "/media",
    express.static(path.join(clientDir, "media"), { maxAge: "1d" }),
  );
  app.use(
    "/images",
    express.static(path.join(clientDir, "images"), { maxAge: "1d" }),
  );
  const template = await readFile(path.join(clientDir, "index.html"), "utf8");
  const entry = await import(
    pathToFileURL(path.join(clientDir, "server/entry-server.js")).href
  );
  app.get("/{*path}", async (req, res) => {
    const url = new URL(req.originalUrl, env.APP_ORIGIN);
    if (/\.(?:js|css|webp|png|jpg|ico|map|woff2?)$/.test(url.pathname)) {
      res.status(404).end();
      return;
    }
    const publicRoute =
      url.pathname === "/" ||
      url.pathname === "/shop" ||
      url.pathname.startsWith("/products/") ||
      url.pathname === "/contact" ||
      url.pathname.startsWith("/policies/");
    let html = "",
      state: unknown = null,
      title = "COZZY — Step into the world of fashion",
      description =
        "Discover the original COZZY collection. Fashion essentials and individual style, delivered across Sri Lanka.",
      image = `${env.APP_ORIGIN}/media/hero.webp`,
      structured: unknown = null;
    if (publicRoute) {
      const store = await storeData();
      const products: {
        params: string;
        value: Awaited<ReturnType<typeof listProducts>>;
      }[] = [];
      let product: Awaited<ReturnType<typeof findProduct>> | undefined;
      if (url.pathname === "/") {
        for (const params of ["featured=true&limit=8", "sort=popular&limit=4"])
          products.push({
            params,
            value: await listProducts(
              Object.fromEntries(new URLSearchParams(params)),
            ),
          });
      }
      if (url.pathname === "/shop") {
        title = "The collection — COZZY";
        products.push({
          params: url.searchParams.toString(),
          value: await listProducts(Object.fromEntries(url.searchParams)),
        });
      }
      if (url.pathname.startsWith("/products/")) {
        try {
          product = await findProduct(
            decodeURIComponent(url.pathname.slice("/products/".length)),
          );
        } catch (error) {
          if (error instanceof AppError && error.status === 404)
            res.status(404);
          else throw error;
        }
        if (product) {
          title = `${product.name} — COZZY`;
          description = product.description.slice(0, 160);
          image = product.images[0]?.url.startsWith("/")
            ? env.APP_ORIGIN + product.images[0].url
            : product.images[0]?.url;
          products.push({
            params: `gender=${product.gender}&limit=5`,
            value: await listProducts({ gender: product.gender, limit: 5 }),
          });
          structured = {
            "@context": "https://schema.org",
            "@type": "Product",
            name: product.name,
            description: product.description,
            image: product.images.map((i) =>
              i.url.startsWith("/") ? env.APP_ORIGIN + i.url : i.url,
            ),
            sku: product.variants[0]?.sku,
            brand: { "@type": "Brand", name: "COZZY" },
            offers: product.variants.map((v) => ({
              "@type": "Offer",
              sku: v.sku,
              url: env.APP_ORIGIN + url.pathname,
              priceCurrency: "LKR",
              price: ((v.price ?? product!.price) / 100).toFixed(2),
              availability: `https://schema.org/${(v.inventory?.stock ?? 0) > 0 ? "InStock" : "OutOfStock"}`,
            })),
            ...(product.reviewCount
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: product.rating,
                    reviewCount: product.reviewCount,
                  },
                }
              : {}),
          };
        }
      }
      const rendered = entry.render(req.originalUrl, {
        store,
        products,
        product,
      });
      html = rendered.html;
      state = rendered.state;
    }
    const known =
      publicRoute ||
      /^\/(account(?:\/.*)?|admin(?:\/.*)?|orders\/[^/]+|cart|checkout|wishlist|newsletter\/(confirm|unsubscribe))$/.test(
        url.pathname,
      );
    if (!known) res.status(404);
    const head = `<meta name="description" content="${escape(description)}"/><meta name="robots" content="${publicRoute ? "index,follow" : "noindex,nofollow"}"/><link rel="canonical" href="${escape(env.APP_ORIGIN + url.pathname + (url.pathname === "/shop" ? url.search : ""))}"/><meta property="og:title" content="${escape(title)}"/><meta property="og:description" content="${escape(description)}"/><meta property="og:type" content="${productType(url.pathname)}"/><meta property="og:url" content="${escape(env.APP_ORIGIN + url.pathname)}"/><meta property="og:image" content="${escape(image)}"/><meta name="twitter:card" content="summary_large_image"/>${structured ? `<script type="application/ld+json">${json(structured)}</script>` : ""}`;
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(
      template
        .replace(/<title>.*?<\/title>/, `<title>${escape(title)}</title>`)
        .replace("<!--app-head-->", head)
        .replace("<!--app-html-->", html)
        .replace(
          "<!--app-data-->",
          state
            ? `<script type="application/json" id="cozzy-data">${json(state)}</script>`
            : "",
        ),
    );
  });
} else
  app.get("/", (_req, res) =>
    res.json({
      message:
        "COZZY API ready. Run the Vite frontend for development, or npm run build for the production storefront.",
    }),
  );
function productType(pathname: string) {
  return pathname.startsWith("/products/") ? "product" : "website";
}
app.use(errorHandler);
const server = app.listen(env.PORT, "0.0.0.0", () =>
  logger.info({ port: env.PORT }, "COZZY server ready"),
);
const mailTimer = setInterval(
  () =>
    deliverMail().catch((err) =>
      logger.error({ message: err.message }, "Mail worker failed"),
    ),
  15000,
);
const orderTimer = setInterval(
  () =>
    expireOrders().catch((err) =>
      logger.error({ message: err.message }, "Reservation worker failed"),
    ),
  60000,
);
mailTimer.unref();
orderTimer.unref();
async function stop() {
  clearInterval(mailTimer);
  clearInterval(orderTimer);
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

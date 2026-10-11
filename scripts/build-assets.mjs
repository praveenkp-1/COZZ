import { access, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");

export function mediaFilename(source) {
  if (
    typeof source !== "string" ||
    !source.startsWith("source/") ||
    source.includes("\\") ||
    source.split("/").some((part) => !part || part === "." || part === "..") ||
    !/\.(jpg|jpeg|png|webp)$/i.test(source)
  )
    throw new Error(`Invalid catalog image source: ${source}`);
  return `${createHash("sha256").update(source).digest("hex").slice(0, 16)}.webp`;
}

export async function readCatalog(projectRoot = root) {
  const products = JSON.parse(
    await readFile(path.join(projectRoot, "data/products.json"), "utf8"),
  );
  if (!Array.isArray(products) || !products.length)
    throw new Error("The maintained product catalog is empty.");
  const slugs = new Set();
  for (const product of products) {
    if (
      !product.slug ||
      slugs.has(product.slug) ||
      !Number.isSafeInteger(product.price) ||
      product.price <= 0 ||
      !product.images?.length
    ) {
      throw new Error(`Invalid or duplicate catalog product: ${product.slug}`);
    }
    slugs.add(product.slug);
    for (const image of product.images) {
      const expected = `/media/${mediaFilename(image.source)}`;
      if (image.url !== expected)
        throw new Error(
          `Image URL changed for ${product.slug}: expected ${expected}`,
        );
      await access(path.join(projectRoot, image.source));
    }
    if (product.reference) {
      if (
        !product.reference.startsWith("source/") ||
        product.reference.includes("\\") ||
        product.reference.split("/").includes("..") ||
        !product.reference.endsWith(".txt")
      ) {
        throw new Error(`Invalid product reference: ${product.reference}`);
      }
      await access(path.join(projectRoot, product.reference));
    }
  }
  return products;
}

export async function buildAssets(projectRoot = root) {
  const products = await readCatalog(projectRoot);
  const media = path.join(projectRoot, "frontend/public/media");
  await mkdir(media, { recursive: true });
  const builderModified = (await stat(import.meta.filename)).mtimeMs;
  async function render(source, output, transform) {
    const input = path.join(projectRoot, source);
    const target = path.join(media, output);
    const modified = Math.max((await stat(input)).mtimeMs, builderModified);
    try {
      if ((await stat(target)).mtimeMs >= modified) return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await transform(sharp(input)).toFile(target);
  }
  const images = new Set(
    products.flatMap((product) => product.images.map((image) => image.source)),
  );
  for (const source of images) {
    const filename = mediaFilename(source);
    const key = filename.slice(0, -5);
    for (const width of [480, 960, 1600]) {
      await render(
        source,
        width === 1600 ? filename : `${key}-${width}.webp`,
        (image) =>
          image
            .rotate()
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: width === 1600 ? 85 : 82 }),
      );
    }
  }
  for (const [output, width, quality] of [
    ["hero.webp", 2000, 87],
    ["hero-mobile.webp", 900, 82],
  ]) {
    await render("source/bacground.webp", output, (image) =>
      image.resize({ width }).webp({ quality }),
    );
  }
  for (const [source, output] of [
    ["source/logo/praveen logo 2w.png", "logo-dark.webp"],
    ["source/logo/praveen logo 2.png", "logo-light.webp"],
  ]) {
    await render(source, output, (image) =>
      image.trim().resize({ width: 320 }).webp({ quality: 95 }),
    );
  }
  await render("source/logo/icon.jpg", "icon.webp", (image) =>
    image.resize(64, 64).webp(),
  );
  console.log(
    `Built media for ${products.length} catalog products and ${images.size} image sources. Catalog data and image URLs were preserved.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    await buildAssets();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

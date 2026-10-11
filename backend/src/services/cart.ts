import type { Prisma } from "../generated/prisma/client.js";
import { assert } from "../utils/errors.js";
import { calculateTotals } from "./pricing.js";
export const productInclude = {
  images: { orderBy: { position: "asc" as const } },
  category: true,
  variants: { where: { active: true }, include: { inventory: true } },
} satisfies Prisma.ProductInclude;
export async function getCart(tx: Prisma.TransactionClient, cartId: string) {
  const items = await tx.cartItem.findMany({
    where: { cartId },
    include: {
      variant: {
        include: {
          inventory: true,
          product: {
            include: { images: { orderBy: { position: "asc" }, take: 1 } },
          },
        },
      },
    },
    orderBy: { id: "asc" },
  });
  return {
    items: items.map((i) => ({
      id: i.id,
      variantId: i.variantId,
      quantity: i.quantity,
      size: i.variant.size,
      color: i.variant.color,
      stock: i.variant.inventory?.stock ?? 0,
      available:
        i.variant.active &&
        i.variant.product.active &&
        (i.variant.inventory?.stock ?? 0) >= i.quantity,
      unitPrice: i.variant.price ?? i.variant.product.price,
      productId: i.variant.productId,
      name: i.variant.product.name,
      slug: i.variant.product.slug,
      image: i.variant.product.images[0]?.url ?? "",
    })),
    subtotal: items.reduce(
      (s, i) => s + (i.variant.price ?? i.variant.product.price) * i.quantity,
      0,
    ),
  };
}
export async function quoteCart(
  tx: Prisma.TransactionClient,
  cartId: string,
  shippingMethodId: string,
  couponCode: string,
) {
  const cart = await getCart(tx, cartId);
  assert(
    cart.items.every((i) => i.available),
    409,
    "Some items are unavailable. Update your bag before continuing.",
    "STOCK_UNAVAILABLE",
  );
  const shipping = await tx.shippingMethod.findFirst({
    where: { id: shippingMethodId, active: true },
  });
  assert(shipping, 400, "Choose an available delivery method.");
  const settings = await tx.storeSettings.findUniqueOrThrow({
    where: { id: "store" },
  });
  const coupon = couponCode
    ? await tx.coupon.findUnique({ where: { code: couponCode.toUpperCase() } })
    : null;
  assert(!couponCode || coupon, 400, "Discount code not found.");
  return {
    ...calculateTotals(cart.items, shipping, settings.taxBasisPoints, coupon),
    items: cart.items,
    coupon,
    shippingMethod: shipping,
    settings,
  };
}

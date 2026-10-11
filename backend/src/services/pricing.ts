import { assert } from "../utils/errors.js";
export interface PriceLine {
  unitPrice: number;
  quantity: number;
}
export interface CouponRule {
  active: boolean;
  percent: number;
  minimum: number;
  maximumDiscount: number;
  maxUses: number;
  uses: number;
  expiresAt: Date;
}
export function calculateTotals(
  lines: PriceLine[],
  shipping: { fee: number; freeAbove: number },
  taxBasisPoints: number,
  coupon?: CouponRule | null,
  now = new Date(),
) {
  assert(lines.length > 0, 400, "Your bag is empty.");
  assert(
    lines.every(
      (x) =>
        Number.isSafeInteger(x.unitPrice) &&
        x.unitPrice > 0 &&
        Number.isInteger(x.quantity) &&
        x.quantity >= 1 &&
        x.quantity <= 10,
    ),
    400,
    "Invalid order items.",
  );
  const subtotal = lines.reduce((s, x) => s + x.unitPrice * x.quantity, 0);
  assert(
    Number.isSafeInteger(subtotal) && subtotal <= 100000000,
    400,
    "Order total exceeds the supported limit.",
  );
  let discount = 0;
  if (coupon) {
    assert(
      coupon.active && coupon.expiresAt > now && coupon.uses < coupon.maxUses,
      400,
      "This discount code is unavailable.",
    );
    assert(
      subtotal >= coupon.minimum,
      400,
      "Your bag does not meet the discount minimum.",
    );
    discount = Math.min(
      subtotal,
      Math.round((subtotal * coupon.percent) / 100),
      coupon.maximumDiscount || subtotal,
    );
  }
  const delivery =
    shipping.freeAbove > 0 && subtotal - discount >= shipping.freeAbove
      ? 0
      : shipping.fee;
  const tax = Math.round(((subtotal - discount) * taxBasisPoints) / 10000);
  return {
    subtotal,
    discount,
    shipping: delivery,
    tax,
    total: subtotal - discount + delivery + tax,
    currency: "LKR",
  };
}

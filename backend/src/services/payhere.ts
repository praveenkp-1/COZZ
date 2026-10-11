import { createHash } from "node:crypto";
import { env, paymentConfigured } from "../config/env.js";
import { safeEqual } from "../utils/crypto.js";
import { assert } from "../utils/errors.js";
import { z } from "zod";
import type { Order } from "../generated/prisma/client.js";
import type { AddressInput } from "../../../shared/contracts.js";
const md5 = (v: string) =>
  createHash("md5").update(v).digest("hex").toUpperCase();
export function checkoutHash(
  merchant: string,
  order: string,
  amount: string,
  currency: string,
  secret: string,
) {
  return md5(merchant + order + amount + currency + md5(secret));
}
export function notificationSignature(
  merchant: string,
  order: string,
  amount: string,
  currency: string,
  code: string,
  secret: string,
) {
  return md5(merchant + order + amount + currency + code + md5(secret));
}
export const notificationSchema = z.object({
  merchant_id: z.string().min(1).max(40),
  order_id: z.string().min(1).max(80),
  payment_id: z.string().min(1).max(100),
  payhere_amount: z.string().regex(/^\d{1,10}\.\d{2}$/),
  payhere_currency: z.literal("LKR"),
  status_code: z.enum(["2", "0", "-1", "-2", "-3"]),
  md5sig: z.string().regex(/^[a-fA-F0-9]{32}$/),
});
export function verifyNotification(
  data: z.infer<typeof notificationSchema>,
  merchant: string,
  secret: string,
) {
  return (
    data.merchant_id === merchant &&
    safeEqual(
      data.md5sig.toUpperCase(),
      notificationSignature(
        data.merchant_id,
        data.order_id,
        data.payhere_amount,
        data.payhere_currency,
        data.status_code,
        secret,
      ),
    )
  );
}
export function paymentFields(
  order: Order & { payment: { provider: string } | null },
) {
  assert(
    order.payment?.provider === "PAYHERE",
    409,
    "This order does not use online payment.",
  );
  assert(
    paymentConfigured,
    503,
    "Card payments are not available yet. Please contact the store.",
    "PAYMENT_UNCONFIGURED",
  );
  assert(
    order.status === "PENDING_PAYMENT" &&
      order.expiresAt &&
      order.expiresAt > new Date() &&
      !order.stockReleased,
    409,
    "This payment reservation has expired. Place a new order.",
  );
  const address = order.billingAddress as unknown as AddressInput;
  const delivery = order.address as unknown as AddressInput;
  const amount = (order.total / 100).toFixed(2);
  const [firstName, ...lastName] = address.name.split(" ");
  return {
    action:
      env.PAYHERE_MODE === "sandbox"
        ? "https://sandbox.payhere.lk/pay/checkout"
        : "https://www.payhere.lk/pay/checkout",
    fields: {
      merchant_id: env.PAYHERE_MERCHANT_ID,
      return_url: `${env.APP_ORIGIN}/orders/${order.id}?payment=return`,
      cancel_url: `${env.APP_ORIGIN}/orders/${order.id}?payment=cancel`,
      notify_url: `${env.PUBLIC_API_ORIGIN}/api/v1/payments/payhere/notify`,
      order_id: order.id,
      items: `COZZY ${order.number}`,
      currency: "LKR",
      amount,
      first_name: firstName,
      last_name: lastName.join(" ") || firstName,
      email: order.email,
      phone: address.phone,
      address: [address.line1, address.line2].filter(Boolean).join(", "),
      city: address.city,
      country: "Sri Lanka",
      delivery_address: [delivery.line1, delivery.line2]
        .filter(Boolean)
        .join(", "),
      delivery_city: delivery.city,
      delivery_country: "Sri Lanka",
      hash: checkoutHash(
        env.PAYHERE_MERCHANT_ID,
        order.id,
        amount,
        "LKR",
        env.PAYHERE_MERCHANT_SECRET,
      ),
    },
  };
}

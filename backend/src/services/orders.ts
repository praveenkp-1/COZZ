import { randomBytes } from "node:crypto";
import { db } from "../config/db.js";
import { env, paymentConfigured } from "../config/env.js";
import type { Prisma } from "../generated/prisma/client.js";
import type { CheckoutInput } from "../../../shared/contracts.js";
import { serializable } from "../utils/transaction.js";
import { hashToken } from "../utils/crypto.js";
import { assert } from "../utils/errors.js";
import { quoteCart } from "./cart.js";
import { notificationSchema, verifyNotification } from "./payhere.js";
import { queueEmail } from "./mail.js";
export const orderInclude = {
  items: true,
  payment: true,
} satisfies Prisma.OrderInclude;
export async function createOrder(
  userId: string,
  cartId: string,
  email: string,
  input: CheckoutInput,
  key: string,
) {
  const requestHash = hashToken(JSON.stringify(input));
  return serializable(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
      include: orderInclude,
    });
    if (existing) {
      assert(
        existing.requestHash === requestHash,
        409,
        "This checkout key was already used for different details.",
      );
      return existing;
    }
    assert(
      input.paymentMethod === "COD" || paymentConfigured,
      503,
      "Online payment is unavailable. Choose cash on delivery.",
      "PAYMENT_UNCONFIGURED",
    );
    const cashOnDelivery = input.paymentMethod === "COD";
    const quote = await quoteCart(
      tx,
      cartId,
      input.shippingMethodId,
      input.couponCode,
    );
    assert(
      env.NODE_ENV !== "production" || quote.settings.policiesPublished,
      503,
      "Checkout is awaiting store policy publication.",
    );
    for (const item of [...quote.items].sort((a, b) =>
      a.variantId.localeCompare(b.variantId),
    )) {
      const updated = await tx.inventory.updateMany({
        where: { variantId: item.variantId, stock: { gte: item.quantity } },
        data: {
          stock: { decrement: item.quantity },
          reserved: { increment: item.quantity },
        },
      });
      assert(
        updated.count === 1,
        409,
        "An item sold out. Please update your bag.",
      );
    }
    if (quote.coupon) {
      const updated = await tx.coupon.updateMany({
        where: {
          id: quote.coupon.id,
          uses: { lt: quote.coupon.maxUses },
          active: true,
          expiresAt: { gt: new Date() },
        },
        data: { uses: { increment: 1 } },
      });
      assert(
        updated.count === 1,
        409,
        "This discount has just become unavailable.",
      );
    }
    const order = await tx.order.create({
      data: {
        number: `CZ-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex").toUpperCase()}`,
        userId,
        idempotencyKey: key,
        requestHash,
        status: cashOnDelivery ? "CONFIRMED" : "PENDING_PAYMENT",
        email,
        address: input.address,
        billingAddress: input.billingAddress ?? input.address,
        shippingMethodId: quote.shippingMethod.id,
        shippingName: quote.shippingMethod.name,
        subtotal: quote.subtotal,
        discount: quote.discount,
        shipping: quote.shipping,
        tax: quote.tax,
        total: quote.total,
        couponId: quote.coupon?.id,
        notes: input.notes,
        expiresAt: cashOnDelivery ? null : new Date(Date.now() + 30 * 60000),
        items: {
          create: await Promise.all(
            quote.items.map(async (i) => ({
              variantId: i.variantId,
              productName: i.name,
              productSlug: i.slug,
              image: i.image,
              size: i.size,
              color: i.color,
              sku: (
                await tx.productVariant.findUniqueOrThrow({
                  where: { id: i.variantId },
                })
              ).sku,
              unitPrice: i.unitPrice,
              quantity: i.quantity,
            })),
          ),
        },
        payment: {
          create: {
            provider: input.paymentMethod,
            status: cashOnDelivery ? "PENDING_COLLECTION" : "PENDING",
            amount: quote.total,
          },
        },
        ...(quote.coupon
          ? { redemption: { create: { couponId: quote.coupon.id } } }
          : {}),
      },
      include: orderInclude,
    });
    await tx.cartItem.deleteMany({ where: { cartId } });
    if (cashOnDelivery) {
      await queueEmail(
        tx,
        order.email,
        `Order confirmed — ${order.number}`,
        `Thank you for choosing COZZY. Your cash on delivery order is confirmed. Please pay LKR ${(order.total / 100).toFixed(2)} on delivery. No payment has been collected.\nView your order: ${env.APP_ORIGIN}/orders/${order.id}`,
      );
    }
    return order;
  });
}
export async function releaseReservation(
  tx: Prisma.TransactionClient,
  orderId: string,
) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    include: orderInclude,
  });
  if (order.stockReleased || order.payment?.status === "PAID") return;
  assert(
    order.payment?.provider !== "COD" ||
      ["CONFIRMED", "PROCESSING"].includes(order.status),
    409,
    "Shipped cash on delivery orders cannot release a reservation.",
  );
  for (const item of order.items)
    await tx.inventory.update({
      where: { variantId: item.variantId },
      data: {
        stock: { increment: item.quantity },
        reserved: { decrement: item.quantity },
      },
    });
  const redemption = await tx.couponRedemption.findUnique({
    where: { orderId },
  });
  if (redemption && !redemption.releasedAt) {
    await tx.coupon.update({
      where: { id: redemption.couponId },
      data: { uses: { decrement: 1 } },
    });
    await tx.couponRedemption.update({
      where: { id: redemption.id },
      data: { releasedAt: new Date() },
    });
  }
  await tx.order.update({
    where: { id: orderId },
    data: { stockReleased: true },
  });
}
export async function processNotification(body: unknown) {
  const data = notificationSchema.parse(body);
  assert(
    paymentConfigured &&
      verifyNotification(
        data,
        env.PAYHERE_MERCHANT_ID,
        env.PAYHERE_MERCHANT_SECRET,
      ),
    400,
    "Invalid payment signature.",
  );
  const eventKey = hashToken(
    [
      data.order_id,
      data.payment_id,
      data.status_code,
      data.payhere_amount,
      data.payhere_currency,
    ].join(":"),
  );
  return serializable(async (tx) => {
    if (await tx.paymentEvent.findUnique({ where: { eventKey } })) return;
    const order = await tx.order.findUnique({
      where: { id: data.order_id },
      include: orderInclude,
    });
    assert(order?.payment, 404, "Payment order not found.");
    assert(
      order.payment.provider === "PAYHERE",
      400,
      "This order does not use PayHere.",
    );
    assert(
      (order.total / 100).toFixed(2) === data.payhere_amount &&
        order.currency === data.payhere_currency,
      400,
      "Payment amount or currency does not match.",
    );
    if (order.payment.providerPaymentId)
      assert(
        order.payment.providerPaymentId === data.payment_id,
        409,
        "Payment identity does not match this order.",
      );
    await tx.paymentEvent.create({
      data: {
        eventKey,
        paymentId: order.payment.id,
        statusCode: data.status_code,
      },
    });
    if (data.status_code === "0") return;
    if (data.status_code === "2") {
      if (
        [
          "PAID",
          "REFUND_PENDING",
          "REFUNDED",
          "CHARGEDBACK",
          "REVIEW",
        ].includes(order.payment.status)
      )
        return;
      if (
        order.stockReleased ||
        !order.expiresAt ||
        order.expiresAt < new Date()
      ) {
        await releaseReservation(tx, order.id);
        await tx.payment.update({
          where: { id: order.payment.id },
          data: { status: "REVIEW", providerPaymentId: data.payment_id },
        });
        await tx.order.update({
          where: { id: order.id },
          data: { status: "PAYMENT_REVIEW" },
        });
        await queueEmail(
          tx,
          order.email,
          `Payment review — ${order.number}`,
          "We received a payment after the reservation closed. The store must reconcile your payment and inventory before fulfillment. Please contact customer care.",
        );
        return;
      }
      await commitReservation(tx, order.items);
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: "PAID", providerPaymentId: data.payment_id },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CONFIRMED" },
      });
      await queueEmail(
        tx,
        order.email,
        `Order confirmed — ${order.number}`,
        `Thank you for your order. Your payment of LKR ${(order.total / 100).toFixed(2)} is verified.\nView your order: ${env.APP_ORIGIN}/orders/${order.id}`,
      );
    } else if (data.status_code === "-3") {
      if (
        !["PAID", "REFUND_PENDING", "REFUNDED"].includes(order.payment.status)
      )
        await releaseReservation(tx, order.id);
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: "CHARGEDBACK", providerPaymentId: data.payment_id },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "PAYMENT_REVIEW" },
      });
    } else if (order.payment.status === "PENDING") {
      await releaseReservation(tx, order.id);
      await tx.payment.update({
        where: { id: order.payment.id },
        data: { status: "FAILED", providerPaymentId: data.payment_id },
      });
      await tx.order.update({
        where: { id: order.id },
        data: { status: "CANCELLED" },
      });
    }
  });
}
export async function expireOrders() {
  const orders = await db.order.findMany({
    where: {
      status: "PENDING_PAYMENT",
      expiresAt: { lt: new Date() },
      payment: { is: { provider: "PAYHERE", status: "PENDING" } },
    },
    select: { id: true },
    take: 100,
  });
  for (const o of orders)
    await serializable(async (tx) => {
      const order = await tx.order.findUniqueOrThrow({
        where: { id: o.id },
        include: { payment: true },
      });
      if (
        order.status !== "PENDING_PAYMENT" ||
        order.payment?.status !== "PENDING" ||
        order.payment.provider !== "PAYHERE"
      )
        return;
      await releaseReservation(tx, o.id);
      await tx.order.update({
        where: { id: o.id },
        data: { status: "CANCELLED" },
      });
      await tx.payment.update({
        where: { orderId: o.id },
        data: { status: "EXPIRED" },
      });
    });
}

// Available stock is deducted at checkout. Commit its reservation exactly once
// when PayHere confirms payment, or when a COD order ships.
export async function commitReservation(
  tx: Prisma.TransactionClient,
  items: { variantId: string; quantity: number }[],
) {
  for (const item of [...items].sort((a, b) =>
    a.variantId.localeCompare(b.variantId),
  )) {
    const committed = await tx.inventory.updateMany({
      where: { variantId: item.variantId, reserved: { gte: item.quantity } },
      data: { reserved: { decrement: item.quantity } },
    });
    assert(
      committed.count === 1,
      409,
      "The inventory reservation is unavailable.",
    );
    const variant = await tx.productVariant.findUniqueOrThrow({
      where: { id: item.variantId },
      select: { productId: true },
    });
    await tx.product.update({
      where: { id: variant.productId },
      data: { salesCount: { increment: item.quantity } },
    });
  }
}
export async function collectCashPayment(
  orderId: string,
  administratorId: string,
) {
  return serializable(async (tx) => {
    assert(
      await tx.user.findFirst({
        where: { id: administratorId, role: "ADMIN", active: true },
      }),
      403,
      "Administrator access is required.",
    );
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: orderInclude,
    });
    assert(order?.payment, 404, "Order not found.");
    assert(
      order.payment.provider === "COD",
      409,
      "Only cash on delivery payments can be collected here.",
    );
    assert(
      ["SHIPPED", "DELIVERED"].includes(order.status),
      409,
      "Cash collection can be recorded after the order ships.",
    );
    const collectedAt = new Date();
    const updated = await tx.payment.updateMany({
      where: {
        id: order.payment.id,
        provider: "COD",
        status: "PENDING_COLLECTION",
        collectedAt: null,
        collectedById: null,
      },
      data: { status: "PAID", collectedAt, collectedById: administratorId },
    });
    assert(
      updated.count === 1,
      409,
      "This cash payment has already been collected or is no longer collectible.",
    );
    await tx.auditLog.create({
      data: {
        userId: administratorId,
        action: "payment.cod.collect",
        targetId: order.id,
        detail: {
          from: "PENDING_COLLECTION",
          to: "PAID",
          amount: order.total,
          currency: order.currency,
          collectedAt: collectedAt.toISOString(),
        },
      },
    });
    await queueEmail(
      tx,
      order.email,
      `Cash payment collected — ${order.number}`,
      `Your cash payment of LKR ${(order.total / 100).toFixed(2)} has been recorded. Thank you for choosing COZZY.\n${env.APP_ORIGIN}/orders/${order.id}`,
    );
    return tx.order.findUniqueOrThrow({
      where: { id: order.id },
      include: orderInclude,
    });
  });
}

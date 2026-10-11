import type { Order } from "../types";
export function paymentMethodLabel(payment: Order["payment"]) {
  if (!payment) return "Payment unavailable";
  return payment.provider === "COD"
    ? "Cash on Delivery"
    : "PayHere Online Payment";
}
export function paymentStatusLabel(payment: Order["payment"]) {
  if (!payment) return "Payment unavailable";
  if (payment.provider === "COD") {
    if (payment.status === "PENDING_COLLECTION") return "Awaiting collection";
    if (payment.status === "PAID") return "Collected";
    if (payment.status === "FAILED") return "Cancelled — not collected";
  }
  return payment.status.toLowerCase().replaceAll("_", " ");
}

import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { PackageCheck, Clock, ArrowUpRight } from "lucide-react";
import { useSession } from "../hooks/useStore";
import { api, send, money, submitPayment } from "../services/api";
import { Loading, ErrorMessage, useToast } from "../components/Feedback";
import type { Order, PaymentForm } from "../types";
import { paymentMethodLabel, paymentStatusLabel } from "../services/orders";
import { useStore } from "../hooks/useStore";
export default function OrderPage() {
  const { id = "" } = useParams();
  const session = useSession();
  const store = useStore();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const order = useQuery<Order>({
    queryKey: ["order", id],
    queryFn: () => api(`/orders/${id}`),
    enabled: !!session.data?.user,
    refetchInterval: (q) =>
      q.state.data?.status === "PENDING_PAYMENT" ? 5000 : false,
  });
  if (session.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (!session.data?.user)
    return (
      <div className="container page narrow">
        <h1>Sign in to view your order.</h1>
        <Link className="button" to="/account/login">
          Sign in
        </Link>
      </div>
    );
  if (order.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (order.error || !order.data)
    return (
      <div className="container page">
        <ErrorMessage error={order.error} />
      </div>
    );
  const o = order.data;
  const paid = o.payment?.status === "PAID";
  const cod = o.payment?.provider === "COD";
  const codActive =
    cod &&
    ["CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED"].includes(o.status);
  const canCancel =
    o.status === "PENDING_PAYMENT" ||
    (cod &&
      o.status === "CONFIRMED" &&
      o.payment?.status === "PENDING_COLLECTION");
  return (
    <div className="container page">
      <div className="order-confirmation">
        {paid || codActive ? <PackageCheck size={36} /> : <Clock size={36} />}
        <p className="eyebrow">{o.number}</p>
        <h1>
          {paid || codActive
            ? "Your order is confirmed."
            : o.status === "PENDING_PAYMENT"
              ? "Awaiting payment confirmation."
              : o.status === "CANCELLED"
                ? "Order cancelled."
                : "Your order update."}
        </h1>
        <p>
          {codActive && !paid
            ? "Thank you for choosing COZZY. Your cash on delivery order is confirmed. Please pay the amount shown below when it arrives. No payment has been collected yet."
            : paid
              ? "Thank you for choosing COZZY. Follow your order below."
              : o.status === "PENDING_PAYMENT"
                ? "This page updates after the payment provider confirms your payment. Returning from PayHere alone does not confirm payment."
                : o.status === "PAYMENT_REVIEW"
                  ? "Your payment needs review. Please contact customer care with your order number."
                  : "View the current status and details below."}
        </p>
        <span className="status-badge">
          {o.status.replaceAll("_", " ").toLowerCase()}
        </span>
      </div>
      <div className="commerce-layout">
        <div>
          <h2>Order details</h2>
          {o.items.map((i) => (
            <article className="cart-item" key={i.id}>
              <Link to={`/products/${i.productSlug}`}>
                <img
                  src={i.image}
                  alt={i.productName}
                  width="120"
                  height="155"
                />
              </Link>
              <div className="cart-item-content">
                <h3>{i.productName}</h3>
                <p>
                  {i.color} / {i.size}
                </p>
                <p>
                  Qty {i.quantity} · {money(i.unitPrice)}
                </p>
              </div>
              <strong>{money(i.unitPrice * i.quantity)}</strong>
            </article>
          ))}
          <div className="address-cards">
            <article>
              <h3>Shipping address</h3>
              <p>
                {o.address.name}
                <br />
                {o.address.line1}
                <br />
                {o.address.line2}
                <br />
                {o.address.city} {o.address.postalCode}
                <br />
                {o.address.phone}
              </p>
            </article>
            <article>
              <h3>Delivery</h3>
              <p>{o.shippingName}</p>
              <p>
                {o.tracking
                  ? `Tracking reference: ${o.tracking}`
                  : "Tracking is added when your order ships."}
              </p>
              <h3>Payment</h3>
              <p>{paymentMethodLabel(o.payment)}</p>
              <p>{paymentStatusLabel(o.payment)}</p>
              {cod && o.payment?.status === "PENDING_COLLECTION" && (
                <p>
                  Amount due on delivery: <strong>{money(o.total)}</strong>
                </p>
              )}
              {o.payment?.collectedAt && (
                <p>
                  Collected on{" "}
                  {new Date(o.payment.collectedAt).toLocaleString("en-GB")}
                </p>
              )}
              {o.payment?.refundReference && (
                <p>Refund reference: {o.payment.refundReference}</p>
              )}
            </article>
          </div>
          {canCancel && (
            <div className="button-row">
              {o.status === "PENDING_PAYMENT" && !cod && (
                <button
                  className="button"
                  disabled={busy || !store.data?.paymentEnabled}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      submitPayment(
                        await send<PaymentForm>(`/orders/${id}/payment`, {}),
                      );
                    } catch (e) {
                      toast((e as Error).message, true);
                      setBusy(false);
                    }
                  }}
                >
                  Continue payment
                  <ArrowUpRight size={17} />
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await send(`/orders/${id}/cancel`, {});
                    qc.invalidateQueries({ queryKey: ["order", id] });
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Cancel unpaid order
              </button>
            </div>
          )}
          {o.status === "PENDING_PAYMENT" && !store.data?.paymentEnabled && (
            <p className="notice">
              Online payment is currently unavailable. Contact customer care or
              cancel this unpaid order and choose cash on delivery at checkout.
            </p>
          )}
          <p>
            <Link to="/contact">Need help with this order?</Link>
          </p>
        </div>
        <aside className="order-summary">
          <h2>Summary</h2>
          {(["subtotal", "discount", "shipping", "tax", "total"] as const).map(
            (key) => (
              <div
                key={key}
                className={`summary-row ${key === "total" ? "summary-total" : ""}`}
              >
                <span>{key[0].toUpperCase() + key.slice(1)}</span>
                <span>
                  {key === "discount" ? "− " : ""}
                  {money(o[key])}
                </span>
              </div>
            ),
          )}
          <Link className="button secondary" to="/account">
            All my orders
          </Link>
        </aside>
      </div>
    </div>
  );
}

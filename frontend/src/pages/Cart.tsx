import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  ArrowUpRight,
  Minus,
  Plus,
  X,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useCart, useCartUpdate, useStore } from "../hooks/useStore";
import { api, money } from "../services/api";
import { Loading, ErrorMessage, useToast } from "../components/Feedback";
import type { Cart } from "../types";
export default function CartPage() {
  const cart = useCart();
  const update = useCartUpdate();
  const store = useStore();
  const toast = useToast();
  const qc = useQueryClient();
  const [removing, setRemoving] = useState("");
  async function remove(id: string) {
    setRemoving(id);
    try {
      qc.setQueryData(
        ["cart"],
        await api<Cart>(`/cart/items/${id}`, { method: "DELETE" }),
      );
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setRemoving("");
    }
  }
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>Shopping bag</span>
      </div>
      <div className="page-heading">
        <p className="eyebrow">YOUR NEXT FAVORITES</p>
        <h1>
          Your shopping bag{" "}
          <span className="count">
            ({cart.data?.items.reduce((s, i) => s + i.quantity, 0) ?? 0})
          </span>
        </h1>
      </div>
      {cart.isPending ? (
        <Loading />
      ) : cart.error ? (
        <ErrorMessage error={cart.error} retry={() => cart.refetch()} />
      ) : !cart.data?.items.length ? (
        <div className="empty-state">
          <ShoppingBag size={44} />
          <h2>A little room for something new.</h2>
          <p>Your bag is waiting for your next favorite piece.</p>
          <Link className="button" to="/shop">
            Explore the collection
            <ArrowUpRight size={18} />
          </Link>
        </div>
      ) : (
        <div className="commerce-layout">
          <div className="cart-items">
            {cart.data.items.map((i) => (
              <article
                className={`cart-item ${!i.available ? "unavailable" : ""}`}
                key={i.id}
              >
                <Link to={`/products/${i.slug}`}>
                  <img src={i.image} alt={i.name} width="150" height="190" />
                </Link>
                <div className="cart-item-content">
                  <Link to={`/products/${i.slug}`}>
                    <h2>{i.name}</h2>
                  </Link>
                  <p className="muted">
                    {i.color} / Size {i.size}
                  </p>
                  <p>{money(i.unitPrice)}</p>
                  {!i.available && (
                    <p className="field-error">
                      Requested quantity unavailable. {i.stock} left.
                    </p>
                  )}
                  <div className="quantity-control">
                    <button
                      aria-label={`Decrease ${i.name} quantity`}
                      disabled={i.quantity <= 1 || update.isPending}
                      onClick={() =>
                        update.mutate(
                          { variantId: i.variantId, quantity: i.quantity - 1 },
                          { onError: (e) => toast(e.message, true) },
                        )
                      }
                    >
                      <Minus size={14} />
                    </button>
                    <span>{i.quantity}</span>
                    <button
                      aria-label={`Increase ${i.name} quantity`}
                      disabled={
                        i.quantity >= Math.min(10, i.stock) || update.isPending
                      }
                      onClick={() =>
                        update.mutate(
                          { variantId: i.variantId, quantity: i.quantity + 1 },
                          { onError: (e) => toast(e.message, true) },
                        )
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <div className="cart-item-end">
                  <button
                    className="icon-button"
                    aria-label={`Remove ${i.name}`}
                    disabled={removing === i.id}
                    onClick={() => remove(i.id)}
                  >
                    <X size={18} />
                  </button>
                  <strong>{money(i.unitPrice * i.quantity)}</strong>
                </div>
              </article>
            ))}
            <Link className="text-link" to="/shop">
              Continue exploring
              <ArrowUpRight size={16} />
            </Link>
          </div>
          <aside className="order-summary">
            <h2>Order summary</h2>
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{money(cart.data.subtotal)}</span>
            </div>
            <div className="summary-row muted">
              <span>Delivery & tax</span>
              <span>At checkout</span>
            </div>
            <p className="muted small">
              Discounts and final delivery charges are calculated before
              payment.
            </p>
            <Link
              className={`button ${cart.data.items.some((i) => !i.available) ? "disabled" : ""}`}
              to="/checkout"
              aria-disabled={cart.data.items.some((i) => !i.available)}
              onClick={(e) => {
                if (cart.data?.items.some((i) => !i.available))
                  e.preventDefault();
              }}
            >
              Continue to checkout
              <ArrowUpRight size={18} />
            </Link>
            <span className="secure-note">
              <ShieldCheck size={15} />
              Secure payment with PayHere
            </span>
            {(store.data?.shippingMethods[0]?.freeAbove ?? 0) > 0 && (
              <p className="small muted">
                Free standard delivery on eligible orders from{" "}
                {money(store.data!.shippingMethods[0].freeAbove)}.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

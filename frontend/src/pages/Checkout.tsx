import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LockKeyhole, ArrowUpRight, Banknote } from "lucide-react";
import { addressSchema } from "../../../shared/contracts";
import type { AddressInput } from "../../../shared/contracts";
import { useSession, useStore, useCart } from "../hooks/useStore";
import { api, send, money, submitPayment } from "../services/api";
import { Loading, ErrorMessage } from "../components/Feedback";
import type { Address, Quote, Order, PaymentForm } from "../types";
import {
  readCheckoutKey,
  saveCheckoutKey,
  clearCheckoutKey,
} from "../services/checkout";
export function AddressFields({
  form,
  prefix = "",
}: {
  form: ReturnType<typeof useForm<AddressInput>>;
  prefix?: string;
}) {
  return (
    <div className="form-grid">
      {(
        [
          { name: "name", label: "Full name", auto: "name" },
          {
            name: "phone",
            label: "Phone number",
            auto: "tel",
            placeholder: "0771234567",
          },
          { name: "line1", label: "Address", auto: "address-line1" },
          {
            name: "line2",
            label: "Apartment, suite, etc. (optional)",
            auto: "address-line2",
          },
          { name: "city", label: "City", auto: "address-level2" },
          { name: "postalCode", label: "Postal code", auto: "postal-code" },
        ] as const
      ).map((f) => (
        <label
          key={f.name}
          className={f.name.startsWith("line") ? "full-width" : ""}
          htmlFor={prefix + f.name}
        >
          {f.label}
          <input
            id={prefix + f.name}
            autoComplete={f.auto}
            placeholder={"placeholder" in f ? f.placeholder : undefined}
            {...form.register(f.name)}
            aria-invalid={!!form.formState.errors[f.name]}
          />
          {form.formState.errors[f.name] && (
            <span className="field-error">
              {form.formState.errors[f.name]?.message}
            </span>
          )}
        </label>
      ))}
      <label>
        Country
        <input value="Sri Lanka" readOnly />
      </label>
    </div>
  );
}
const blankAddress: Address = {
  name: "",
  phone: "",
  line1: "",
  line2: "",
  city: "",
  postalCode: "",
  country: "LK",
};
export default function Checkout() {
  const session = useSession();
  const store = useStore();
  const cart = useCart();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [shipping, setShipping] = useState("");
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState("");
  const [busy, setBusy] = useState(false);
  const [billingSame, setBillingSame] = useState(true);
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const idempotency = useRef("");
  const inFlight = useRef(false);
  const [attemptKey, setAttemptKey] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "PAYHERE">("COD");
  const form = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: blankAddress,
  });
  const billing = useForm<AddressInput>({
    resolver: zodResolver(addressSchema),
    defaultValues: blankAddress,
  });
  const addresses = useQuery<Address[]>({
    queryKey: ["addresses"],
    queryFn: () => api("/addresses"),
    enabled: !!session.data?.user,
  });
  useEffect(() => {
    if (!session.data?.user) return;
    const key = readCheckoutKey(session.data.user.id);
    idempotency.current = key;
    setAttemptKey(key);
  }, [session.data?.user?.id]);
  const attempt = useQuery<{ order: Order | null }>({
    queryKey: ["checkout-attempt", session.data?.user?.id, attemptKey],
    queryFn: () => api("/checkout/attempts/" + attemptKey),
    enabled: !!session.data?.user && !!attemptKey && !busy,
    retry: false,
  });
  useEffect(() => {
    if (!attempt.data?.order || !session.data?.user) return;
    clearCheckoutKey(session.data.user.id);
    qc.invalidateQueries({ queryKey: ["cart"] });
    qc.invalidateQueries({ queryKey: ["orders"] });
    navigate("/orders/" + attempt.data.order.id, { replace: true });
  }, [attempt.data, session.data?.user?.id, navigate, qc]);
  const method = shipping || store.data?.shippingMethods[0]?.id || "";
  const quote = useQuery<Quote>({
    queryKey: ["quote", method, applied, cart.data?.items],
    queryFn: () =>
      send("/cart/quote", { shippingMethodId: method, couponCode: applied }),
    enabled: !!cart.data?.items.length && !!method,
    retry: false,
  });
  useEffect(() => {
    if (session.data?.user && !form.getValues("name"))
      form.setValue("name", session.data.user.name);
  }, [session.data]);
  if (session.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (!session.data?.user)
    return (
      <div className="container page narrow">
        <h1>A secure checkout, just for you.</h1>
        <p>Sign in or create an account to save and track your order.</p>
        <Link className="button" to="/account/login?next=checkout">
          Sign in to checkout
          <ArrowUpRight size={18} />
        </Link>
        <p>
          <Link to="/account/register">Create an account</Link>
        </p>
      </div>
    );
  if (!session.data.user.verified)
    return (
      <div className="container page narrow">
        <h1>Verify your email</h1>
        <p>Check your inbox before placing your first order.</p>
        <Link className="button" to="/account">
          Manage your account
        </Link>
      </div>
    );
  if (cart.isPending || store.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (cart.error || store.error)
    return (
      <div className="container page">
        <ErrorMessage error={cart.error || store.error} />
      </div>
    );
  if (!cart.data?.items.length && attemptKey)
    return (
      <div className="container page narrow">
        <p className="eyebrow">YOUR CHECKOUT</p>
        <h1>Let’s check your order.</h1>
        <p>
          If your checkout was interrupted, we’ll find the order before you
          place another.
        </p>
        {attempt.isFetching ? (
          <Loading />
        ) : attempt.error ? (
          <ErrorMessage error={attempt.error} />
        ) : (
          <p>
            No completed order was found yet. Check again or return to your
            shopping bag.
          </p>
        )}
        <div className="button-row">
          <button
            className="button"
            disabled={attempt.isFetching}
            onClick={() => attempt.refetch()}
          >
            Check order status
          </button>
          <Link className="button secondary" to="/account">
            My orders
          </Link>
          <Link className="text-link" to="/cart">
            Shopping bag
          </Link>
        </div>
      </div>
    );
  if (!cart.data?.items.length)
    return (
      <div className="container page empty-state">
        <h1>Your bag is empty.</h1>
        <Link className="button" to="/shop">
          Find something you love
        </Link>
      </div>
    );
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/cart">Shopping bag</Link>
        <span>/</span>
        <span>Checkout</span>
      </div>
      <div className="page-heading">
        <p className="eyebrow">ONE STEP CLOSER</p>
        <h1>Checkout</h1>
      </div>
      <form
        className="commerce-layout"
        onSubmit={form.handleSubmit(async (address) => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          setError(null);
          try {
            if (!billingSame && !(await billing.trigger())) return;
            if (!consent)
              throw new Error("Please accept the terms and privacy policy.");
            if (paymentMethod === "PAYHERE" && !store.data?.paymentEnabled)
              throw new Error(
                "Online payment is unavailable. Choose cash on delivery.",
              );
            const input = {
              address,
              ...(!billingSame ? { billingAddress: billing.getValues() } : {}),
              shippingMethodId: method,
              couponCode: applied,
              paymentMethod,
              notes,
            };
            // Retain this key until success, including after a lost response.
            // Changed details cannot create a second order with the same key.
            if (!idempotency.current) {
              idempotency.current = crypto.randomUUID();
              saveCheckoutKey(session.data!.user!.id, idempotency.current);
            }
            const result = await send<{
              order: Order;
              payment: PaymentForm | null;
            }>("/checkout", input, "POST", {
              "Idempotency-Key": idempotency.current,
            });
            clearCheckoutKey(session.data!.user!.id);
            setAttemptKey("");
            qc.setQueryData(["order", result.order.id], result.order);
            qc.invalidateQueries({ queryKey: ["cart"] });
            qc.invalidateQueries({ queryKey: ["orders"] });
            navigate("/orders/" + result.order.id);
            if (result.payment) submitPayment(result.payment);
          } catch (e) {
            setError(e);
            setAttemptKey(idempotency.current);
            qc.invalidateQueries({ queryKey: ["checkout-attempt"] });
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        })}
      >
        <div className="checkout-fields">
          <section className="form-section">
            <h2>01 / Contact</h2>
            <p>{session.data.user.email}</p>
          </section>
          <section className="form-section">
            <h2>02 / Shipping address</h2>
            {addresses.data?.length ? (
              <label>
                Use a saved address
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const selected = addresses.data?.find(
                      (a) => a.id === e.target.value,
                    );
                    if (selected) {
                      const { id, ...address } = selected;
                      form.reset(address);
                    }
                  }}
                >
                  <option value="">Enter a new address</option>
                  {addresses.data.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.line1}, {a.city}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <AddressFields form={form} />
            <label className="check-label">
              <input
                type="checkbox"
                checked={billingSame}
                onChange={(e) => setBillingSame(e.target.checked)}
              />
              Billing address is the same as shipping address
            </label>
            {!billingSame && (
              <>
                <h3>Billing address</h3>
                <AddressFields form={billing} prefix="billing-" />
              </>
            )}
          </section>
          <section className="form-section">
            <h2>03 / Delivery</h2>
            {store.data?.shippingMethods.map((s) => (
              <label className="radio-card" key={s.id}>
                <input
                  type="radio"
                  name="shippingMethod"
                  value={s.id}
                  checked={method === s.id}
                  onChange={() => setShipping(s.id)}
                />
                <span>
                  <strong>{s.name}</strong>
                  <small>{s.description}</small>
                </span>
                <span>
                  {s.freeAbove > 0 && cart.data!.subtotal >= s.freeAbove
                    ? "Calculated in summary"
                    : money(s.fee)}
                </span>
              </label>
            ))}
          </section>
          <section className="form-section">
            <h2>04 / Payment</h2>
            <label className="radio-card">
              <input
                type="radio"
                name="paymentMethod"
                value="COD"
                checked={paymentMethod === "COD"}
                onChange={() => setPaymentMethod("COD")}
                disabled={busy}
              />
              <span>
                <strong>Cash on Delivery</strong>
                <small>
                  Pay the full order total in cash when your order arrives.
                </small>
              </span>
              <Banknote size={22} />
            </label>
            <label className="radio-card">
              <input
                type="radio"
                name="paymentMethod"
                value="PAYHERE"
                checked={paymentMethod === "PAYHERE"}
                onChange={() => setPaymentMethod("PAYHERE")}
                disabled={busy || !store.data?.paymentEnabled}
                aria-describedby={
                  !store.data?.paymentEnabled
                    ? "online-payment-status"
                    : undefined
                }
              />
              <span>
                <strong>PayHere Online Payment</strong>
                <small>
                  You’ll continue to PayHere to complete your payment.
                </small>
              </span>
              <LockKeyhole size={22} />
            </label>
            {!store.data?.paymentEnabled && (
              <p className="notice" id="online-payment-status" role="status">
                Online payment is currently unavailable. You can complete your
                order with cash on delivery.
              </p>
            )}
            {paymentMethod === "PAYHERE" &&
              store.data?.paymentEnabled &&
              store.data.paymentMode === "sandbox" && (
                <p className="notice">
                  Payment sandbox: use test payments only.
                </p>
              )}
            <label>
              Order notes (optional)
              <textarea
                value={notes}
                maxLength={500}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </section>
        </div>
        <aside className="order-summary">
          <h2>Your order</h2>
          {cart.data.items.map((i) => (
            <div className="checkout-item" key={i.id}>
              <img src={i.image} alt={i.name} width="60" height="78" />
              <div>
                <strong>{i.name}</strong>
                <small>
                  {i.size} / {i.color} · Qty {i.quantity}
                </small>
                <span>{money(i.unitPrice * i.quantity)}</span>
              </div>
            </div>
          ))}
          <div className="coupon-field">
            <label htmlFor="coupon">Discount code</label>
            <div>
              <input
                id="coupon"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                maxLength={40}
              />
              <button
                className="button secondary"
                type="button"
                onClick={() => setApplied(coupon.trim())}
              >
                Apply
              </button>
            </div>
            {applied && (
              <button
                type="button"
                className="text-link small"
                onClick={() => {
                  setApplied("");
                  setCoupon("");
                }}
              >
                Remove code
              </button>
            )}
          </div>
          {quote.error ? (
            <ErrorMessage error={quote.error} />
          ) : quote.isPending ? (
            <Loading />
          ) : (
            quote.data && (
              <>
                <div className="summary-row">
                  <span>Subtotal</span>
                  <span>{money(quote.data.subtotal)}</span>
                </div>
                <div className="summary-row">
                  <span>Discount</span>
                  <span>− {money(quote.data.discount)}</span>
                </div>
                <div className="summary-row">
                  <span>Shipping</span>
                  <span>
                    {quote.data.shipping ? money(quote.data.shipping) : "Free"}
                  </span>
                </div>
                <div className="summary-row">
                  <span>Tax</span>
                  <span>{money(quote.data.tax)}</span>
                </div>
                <div className="summary-row summary-total">
                  <span>Total</span>
                  <span>{money(quote.data.total)}</span>
                </div>
              </>
            )
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              required
            />
            <span>
              I accept the <Link to="/policies/terms">terms</Link> and{" "}
              <Link to="/policies/privacy">privacy policy</Link>.
            </span>
          </label>
          {!!error && <ErrorMessage error={error} />}
          {attemptKey && (
            <button
              type="button"
              className="text-link"
              disabled={attempt.isFetching || busy}
              onClick={() => attempt.refetch()}
            >
              Check previous order status
            </button>
          )}
          {attempt.error && <ErrorMessage error={attempt.error} />}
          <button
            className="button"
            disabled={
              busy ||
              !quote.data ||
              quote.isFetching ||
              !!quote.error ||
              (paymentMethod === "PAYHERE" && !store.data?.paymentEnabled) ||
              !consent
            }
          >
            {busy
              ? "Preparing your order…"
              : paymentMethod === "COD"
                ? "Place cash on delivery order"
                : "Continue to secure payment"}
            <LockKeyhole size={17} />
          </button>
          <p className="small muted">
            {paymentMethod === "COD"
              ? "Your order will be confirmed now. Pay the total shown above on delivery; no payment is collected at checkout."
              : "Your order is confirmed after PayHere verifies payment. Reserved items are held for 30 minutes."}
          </p>
        </aside>
      </form>
    </div>
  );
}

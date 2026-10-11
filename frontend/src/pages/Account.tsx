import { paymentMethodLabel, paymentStatusLabel } from "../services/orders";
import { useState, useEffect } from "react";
import {
  Routes,
  Route,
  Link,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ArrowUpRight,
  LogOut,
  Package,
  MapPin,
  UserRound,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  loginSchema,
  registerSchema,
  passwordSchema,
} from "../../../shared/contracts";
import { useSession } from "../hooks/useStore";
import { api, send, setSession, money } from "../services/api";
import { Loading, ErrorMessage, useToast } from "../components/Feedback";
import type { Session, Order, Address } from "../types";
const FormError = ({
  errors,
}: {
  errors: Record<string, { message?: string }>;
}) => (
  <>
    {Object.entries(errors).map(([key, value]) => (
      <p className="field-error" role="alert" key={key}>
        {value.message}
      </p>
    ))}
  </>
);
function Login() {
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return (
    <div className="auth-layout">
      <div className="auth-editorial">
        <p className="eyebrow">WELCOME BACK TO COZZY</p>
        <h1>
          Your style.
          <br />
          Your space.
        </h1>
        <p>Sign in to keep your favorites close and follow every order.</p>
        <Link to="/shop" className="text-link">
          Explore the collection
          <ArrowUpRight size={16} />
        </Link>
      </div>
      <form
        className="auth-form"
        onSubmit={form.handleSubmit(async (values) => {
          setError(undefined);
          try {
            const s = await send<Session>("/auth/login", values);
            setSession(s);
            qc.setQueryData(["session"], s);
            await qc.invalidateQueries({ queryKey: ["cart"] });
            await qc.invalidateQueries({ queryKey: ["wishlist"] });
            navigate(
              params.get("next") === "checkout" ? "/checkout" : "/account",
            );
          } catch (e) {
            setError(e);
          }
        })}
      >
        <p className="eyebrow">YOUR COZZY ACCOUNT</p>
        <h2>Sign in</h2>
        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            {...form.register("email")}
            aria-invalid={!!form.formState.errors.email}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            {...form.register("password")}
            aria-invalid={!!form.formState.errors.password}
          />
        </label>
        <FormError errors={form.formState.errors} />
        <Link to="/account/forgot" className="text-link small">
          Forgot your password?
        </Link>
        {!!error && <ErrorMessage error={error} />}
        <button className="button" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
          <ArrowUpRight size={17} />
        </button>
        <p className="small muted">
          New to COZZY? <Link to="/account/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
function Register() {
  const form = useForm({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  return (
    <div className="auth-layout">
      <div className="auth-editorial">
        <p className="eyebrow">MAKE YOURSELF AT HOME</p>
        <h1>
          A wardrobe.
          <br />A world of
          <br />
          <em>possibilities.</em>
        </h1>
        <p>Save what you love. Make shopping your own.</p>
      </div>
      <form
        className="auth-form"
        onSubmit={form.handleSubmit(async (values) => {
          setError(undefined);
          try {
            const r = await send<{ message: string }>("/auth/register", values);
            setMessage(r.message);
          } catch (e) {
            setError(e);
          }
        })}
      >
        <h2>Create your account</h2>
        {message ? (
          <div role="status">
            <p>{message}</p>
            <Link to="/account/login" className="button">
              Continue to sign in
            </Link>
          </div>
        ) : (
          <>
            <label>
              Full name
              <input autoComplete="name" {...form.register("name")} />
            </label>
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                {...form.register("email")}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="new-password"
                aria-describedby="register-password-hint"
                {...form.register("password")}
              />
            </label>
            <small id="register-password-hint">
              12–72 characters. Choose a unique password.
            </small>
            <label className="check-label">
              <input type="checkbox" {...form.register("consent")} />
              <span>
                I accept the <Link to="/policies/privacy">privacy policy</Link>.
              </span>
            </label>
            <FormError errors={form.formState.errors} />
            {!!error && <ErrorMessage error={error} />}
            <button className="button" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting
                ? "Creating account…"
                : "Create account"}
              <ArrowUpRight size={17} />
            </button>
            <p className="small muted">
              Already have an account? <Link to="/account/login">Sign in</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
function Recovery({ reset = false }: { reset?: boolean }) {
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""),
  );
  useEffect(() => {
    if (token) history.replaceState(null, "", window.location.pathname);
  }, [token]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  return (
    <div className="container page narrow">
      <p className="eyebrow">YOUR ACCOUNT</p>
      <h1>{reset ? "A fresh start." : "Forgot your password?"}</h1>
      <p>
        {reset
          ? "Choose a new, unique password."
          : "We’ll email a secure link to recover your account."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(undefined);
          try {
            if (reset) passwordSchema.parse(password);
            const r = await send<{ message: string }>(
              `/auth/${reset ? "reset" : "forgot"}`,
              reset ? { token, password } : { email },
            );
            setMessage(r.message);
          } catch (e) {
            setError(
              e instanceof z.ZodError ? new Error(e.issues[0].message) : e,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {message ? (
          <p role="status" className="notice">
            {message}
          </p>
        ) : reset ? (
          <label>
            New password
            <input
              type="password"
              minLength={12}
              maxLength={72}
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : (
          <label>
            Email address
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        )}
        {!!error && <ErrorMessage error={error} />}
        <button className="button" disabled={busy || !!message}>
          {busy
            ? "Please wait…"
            : reset
              ? "Update password"
              : "Send recovery link"}
        </button>
        <p>
          <Link to="/account/login">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
export function TokenAction({
  kind,
}: {
  kind: "verify" | "confirm" | "unsubscribe";
}) {
  const [token] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (new URLSearchParams(window.location.hash.slice(1)).get("token") ?? ""),
  );
  useEffect(() => {
    if (token) history.replaceState(null, "", window.location.pathname);
  }, [token]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const qc = useQueryClient();
  const title =
    kind === "verify"
      ? "Verify your email"
      : kind === "confirm"
        ? "Confirm your subscription"
        : "Unsubscribe from updates";
  return (
    <div className="container page narrow">
      <ShieldCheck size={30} />
      <h1>{title}</h1>
      {!token ? (
        <p>
          This link is missing its security token. Open the complete link from
          your email.
        </p>
      ) : (
        <>
          <p>{message || "Confirm below to complete your request."}</p>
          {!!error && <ErrorMessage error={error} />}
          <button
            className="button"
            disabled={busy || !!message}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await send<{ message: string }>(
                  kind === "verify" ? "/auth/verify" : `/newsletter/${kind}`,
                  { token },
                );
                setMessage(r.message);
                qc.invalidateQueries({ queryKey: ["session"] });
              } catch (e) {
                setError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Please wait…" : title}
          </button>
        </>
      )}
      <p>
        <Link to={kind === "verify" ? "/account/login" : "/"}>
          Continue to COZZY
        </Link>
      </p>
    </div>
  );
}
function Dashboard() {
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState("orders");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const orders = useQuery<Order[]>({
    queryKey: ["orders"],
    queryFn: () => api("/orders"),
    enabled: !!session.data?.user,
  });
  const addresses = useQuery<Address[]>({
    queryKey: ["addresses"],
    queryFn: () => api("/addresses"),
    enabled: !!session.data?.user,
  });
  const [address, setAddress] = useState<Address>({
    name: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    postalCode: "",
    country: "LK",
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  useEffect(() => {
    if (session.data?.user) setName(session.data.user.name);
  }, [session.data]);
  if (session.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (!session.data?.user) return <Navigate to="/account/login" replace />;
  const user = session.data.user;
  async function action(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast(message);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="container page">
      <div className="page-heading">
        <p className="eyebrow">YOUR COZZY SPACE</p>
        <h1>Hello, {user.name.split(" ")[0]}.</h1>
        <p className="muted">
          Your favorites, orders, and details — all in one place.
        </p>
      </div>
      {!user.verified && (
        <div className="notice">
          Please verify your email to place orders.{" "}
          <button
            className="text-link"
            disabled={busy}
            onClick={() =>
              action(
                () => send("/auth/resend-verification", {}),
                "Verification email requested.",
              )
            }
          >
            Resend verification
          </button>
        </div>
      )}
      <div className="account-layout">
        <nav className="account-nav" aria-label="Account sections">
          {[
            { id: "orders", label: "My orders", Icon: Package },
            { id: "addresses", label: "Addresses", Icon: MapPin },
            { id: "profile", label: "Account settings", Icon: UserRound },
          ].map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "selected" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.Icon size={18} />
              {t.label}
            </button>
          ))}
          <Link to="/wishlist">
            My wishlist
            <ArrowUpRight size={16} />
          </Link>
          {user.role === "ADMIN" && (
            <Link to="/admin">
              Store administration
              <ArrowUpRight size={16} />
            </Link>
          )}
          <button
            disabled={busy}
            onClick={() =>
              action(async () => {
                const s = await send<Session>("/auth/logout", {});
                setSession(s);
                qc.clear();
                qc.setQueryData(["session"], s);
                navigate("/");
              }, "Signed out.")
            }
          >
            <LogOut size={18} />
            Sign out
          </button>
        </nav>
        <div className="account-content">
          {tab === "orders" && (
            <>
              <h2>Your orders</h2>
              {orders.isPending ? (
                <Loading />
              ) : orders.error ? (
                <ErrorMessage error={orders.error} />
              ) : orders.data?.length ? (
                <div className="order-list">
                  {orders.data.map((o) => (
                    <Link
                      className="order-list-row"
                      to={`/orders/${o.id}`}
                      key={o.id}
                    >
                      <span>
                        <strong>{o.number}</strong>
                        <small>
                          {new Date(o.createdAt).toLocaleDateString("en-GB")}
                        </small>
                        <small>
                          {paymentMethodLabel(o.payment)} ·{" "}
                          {paymentStatusLabel(o.payment)}
                        </small>
                      </span>
                      <span className="status-badge">
                        {o.status.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <span>{money(o.total)}</span>
                      <ArrowUpRight size={18} />
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Package size={36} />
                  <h3>Your first order awaits.</h3>
                  <Link className="button secondary" to="/shop">
                    Explore the collection
                  </Link>
                </div>
              )}
            </>
          )}
          {tab === "addresses" && (
            <>
              <h2>Saved addresses</h2>
              {addresses.error && <ErrorMessage error={addresses.error} />}
              <div className="address-cards">
                {addresses.data?.map((a) => (
                  <article key={a.id}>
                    <strong>{a.name}</strong>
                    <p>
                      {a.line1}
                      <br />
                      {a.line2}
                      <br />
                      {a.city} {a.postalCode}
                      <br />
                      {a.phone}
                    </p>
                    <div className="button-row">
                      <button
                        className="text-link"
                        onClick={() => setAddress(a)}
                      >
                        Edit
                      </button>
                      <button
                        className="text-link"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            await api(`/addresses/${a.id}`, {
                              method: "DELETE",
                            });
                            qc.invalidateQueries({ queryKey: ["addresses"] });
                          }, "Address removed.")
                        }
                      >
                        <Trash2 size={14} />
                        Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <h3>{address.id ? "Edit address" : "Add an address"}</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    const { id, ...values } = address;
                    await send(
                      id ? `/addresses/${id}` : "/addresses",
                      values,
                      id ? "PUT" : "POST",
                    );
                    await qc.invalidateQueries({ queryKey: ["addresses"] });
                    setAddress({
                      name: "",
                      phone: "",
                      line1: "",
                      line2: "",
                      city: "",
                      postalCode: "",
                      country: "LK",
                    });
                  }, "Address saved.");
                }}
              >
                <div className="form-grid">
                  {(
                    [
                      "name",
                      "phone",
                      "line1",
                      "line2",
                      "city",
                      "postalCode",
                    ] as const
                  ).map((k) => (
                    <label key={k}>
                      {
                        {
                          name: "Full name",
                          phone: "Phone",
                          line1: "Address",
                          line2: "Apartment (optional)",
                          city: "City",
                          postalCode: "Postal code",
                        }[k]
                      }
                      <input
                        required={k !== "line2"}
                        value={address[k]}
                        onChange={(e) =>
                          setAddress((a) => ({ ...a, [k]: e.target.value }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <button className="button" disabled={busy}>
                  Save address
                </button>
              </form>
            </>
          )}
          {tab === "profile" && (
            <>
              <h2>Account settings</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await send("/auth/profile", { name }, "PATCH");
                    qc.invalidateQueries({ queryKey: ["session"] });
                  }, "Profile updated.");
                }}
              >
                <label>
                  Name
                  <input
                    value={name}
                    minLength={2}
                    maxLength={100}
                    required
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label>
                  Email
                  <input value={user.email} readOnly />
                </label>
                <button className="button secondary" disabled={busy}>
                  Save profile
                </button>
              </form>
              <h3>Change password</h3>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await send("/auth/password", { currentPassword, password });
                    setCurrentPassword("");
                    setPassword("");
                  }, "Password changed.");
                }}
              >
                <label>
                  Current password
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </label>
                <label>
                  New password
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={72}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button className="button secondary" disabled={busy}>
                  Update password
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
export default function Account() {
  return (
    <Routes>
      <Route index element={<Dashboard />} />
      <Route path="login" element={<Login />} />
      <Route path="register" element={<Register />} />
      <Route path="forgot" element={<Recovery />} />
      <Route path="reset" element={<Recovery reset />} />
      <Route path="verify" element={<TokenAction kind="verify" />} />
      <Route path="*" element={<Navigate to="/account" replace />} />
    </Routes>
  );
}

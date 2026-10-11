import { paymentMethodLabel, paymentStatusLabel } from "../services/orders";
import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  Users,
  Settings as SettingsIcon,
  Plus,
  ArrowUpRight,
  X,
  Trash2,
  Upload,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useSession, useStore } from "../hooks/useStore";
import { api, send, money } from "../services/api";
import { Loading, ErrorMessage, useToast } from "../components/Feedback";
import type {
  Product,
  ProductList,
  Order,
  Settings,
  Shipping,
  Category,
} from "../types";
type Paged<T> = { items: T[]; total: number; page: number; pages: number };
interface Customer {
  id: string;
  name: string;
  email: string;
  active: boolean;
  verifiedAt: string | null;
  createdAt: string;
  _count: { orders: number };
}
interface Overview {
  revenue: number;
  orders: number;
  customers: number;
  products: number;
  days: { date: string; revenue: number }[];
  recentOrders: Order[];
  lowStock: {
    variantId: string;
    stock: number;
    reserved: number;
    variant: { size: string; color: string; product: { name: string } };
  }[];
}
interface AdminStore {
  settings: Settings;
  shippingMethods: Shipping[];
  categories: Category[];
  coupons: Record<string, unknown>[];
  banners: Record<string, unknown>[];
  collections: (Record<string, unknown> & {
    products: { productId: string }[];
  })[];
  reviews: {
    id: string;
    title: string;
    body: string;
    rating: number;
    approved: boolean;
    user: { name: string };
    product: { name: string };
  }[];
  messages: {
    id: string;
    name: string;
    email: string;
    body: string;
    resolved: boolean;
  }[];
  uploadsEnabled: boolean;
}
function PageButtons({
  data,
  onPage,
}: {
  data: { page: number; pages: number };
  onPage: (n: number) => void;
}) {
  return data.pages > 1 ? (
    <div className="pagination">
      <button
        className="icon-button"
        aria-label="Previous page"
        disabled={data.page <= 1}
        onClick={() => onPage(data.page - 1)}
      >
        <ChevronLeft />
      </button>
      <span>
        {data.page} / {data.pages}
      </span>
      <button
        className="icon-button"
        aria-label="Next page"
        disabled={data.page >= data.pages}
        onClick={() => onPage(data.page + 1)}
      >
        <ChevronRight />
      </button>
    </div>
  ) : null;
}
function CashCollection({ order }: { order: Order | undefined }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(false);
  if (!order || order.payment?.provider !== "COD") return null;
  const canCollect =
    order.payment.status === "PENDING_COLLECTION" &&
    ["SHIPPED", "DELIVERED"].includes(order.status);
  return (
    <section className="form-section" aria-label="Cash collection">
      <h3>Cash on Delivery · {order.number}</h3>
      <p>
        {paymentStatusLabel(order.payment)} ·{" "}
        <strong>{money(order.total)}</strong>
      </p>
      {order.payment.collectedAt ? (
        <p>
          Collected{" "}
          {new Date(order.payment.collectedAt).toLocaleString("en-GB")} by{" "}
          {order.payment.collectedBy?.name ?? order.payment.collectedById}.
        </p>
      ) : canCollect ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !received) return;
            setBusy(true);
            try {
              await send(`/admin/orders/${order.id}/collect`, {});
              await qc.invalidateQueries({ queryKey: ["admin"] });
              qc.invalidateQueries({ queryKey: ["order", order.id] });
              qc.invalidateQueries({ queryKey: ["orders"] });
              toast("Cash payment recorded.");
            } catch (error) {
              toast((error as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="check-label">
            <input
              type="checkbox"
              checked={received}
              onChange={(e) => setReceived(e.target.checked)}
              required
              disabled={busy}
            />
            I confirm the full amount of {money(order.total)} has been received.
          </label>
          <button className="button" disabled={busy || !received}>
            {busy ? "Recording…" : "Mark cash as collected"}
          </button>
        </form>
      ) : order.payment.status === "PENDING_COLLECTION" ? (
        <p className="notice">
          Cash collection can be recorded once this order ships. Confirm receipt
          of the full amount before marking it collected.
        </p>
      ) : null}
    </section>
  );
}
function OrdersTable({ orders }: { orders: Order[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Status</th>
            <th>Payment</th>
            <th>Total</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                {o.number}
                <small>
                  {new Date(o.createdAt).toLocaleDateString("en-GB")}
                </small>
              </td>
              <td>{o.email}</td>
              <td>
                <span className="status-badge">
                  {o.status.toLowerCase().replaceAll("_", " ")}
                </span>
              </td>
              <td>
                {paymentMethodLabel(o.payment)}
                <small>{paymentStatusLabel(o.payment)}</small>
                {o.payment?.collectedAt && (
                  <small>
                    Collected{" "}
                    {new Date(o.payment.collectedAt).toLocaleString("en-GB")} by{" "}
                    {o.payment.collectedBy?.name ?? o.payment.collectedById}
                  </small>
                )}
              </td>
              <td>{money(o.total)}</td>
              <td>
                <Link
                  to={`/orders/${o.id}`}
                  aria-label={`View order ${o.number}`}
                >
                  <ArrowUpRight size={18} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!orders.length && <p className="muted">No orders match.</p>}
    </div>
  );
}
function Dashboard() {
  const data = useQuery<Overview>({
    queryKey: ["admin", "overview"],
    queryFn: () => api("/admin/overview"),
  });
  if (data.isPending) return <Loading />;
  if (data.error || !data.data) return <ErrorMessage error={data.error} />;
  const d = data.data;
  const max = Math.max(1, ...d.days.map((v) => v.revenue));
  return (
    <>
      <div className="admin-stats">
        {[
          { label: "Revenue", value: money(d.revenue) },
          { label: "Orders", value: d.orders },
          { label: "Customers", value: d.customers },
          { label: "Active products", value: d.products },
        ].map((s) => (
          <article key={s.label}>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </article>
        ))}
      </div>
      <section className="admin-panel">
        <h2>Revenue · last 14 days</h2>
        <div
          className="revenue-chart"
          role="img"
          aria-label={`Revenue chart, total ${money(d.days.reduce((s, x) => s + x.revenue, 0))} over the past 14 days`}
        >
          {d.days.map((x) => (
            <div key={x.date} title={`${x.date}: ${money(x.revenue)}`}>
              <span
                style={{ height: `${Math.max(1, (x.revenue / max) * 100)}%` }}
              />
              <small>{x.date.slice(8)}</small>
            </div>
          ))}
        </div>
        <details>
          <summary>View chart data</summary>
          <table>
            <tbody>
              {d.days.map((x) => (
                <tr key={x.date}>
                  <td>{x.date}</td>
                  <td>{money(x.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
      <section className="admin-panel">
        <h2>Recent orders</h2>
        <OrdersTable orders={d.recentOrders} />
      </section>
      <section className="admin-panel">
        <h2>Low-stock alerts</h2>
        {d.lowStock.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Variant</th>
                  <th>Available</th>
                  <th>Reserved</th>
                </tr>
              </thead>
              <tbody>
                {d.lowStock.map((i) => (
                  <tr key={i.variantId}>
                    <td>{i.variant.product.name}</td>
                    <td>
                      {i.variant.color} / {i.variant.size}
                    </td>
                    <td>{i.stock}</td>
                    <td>{i.reserved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>No low-stock variants.</p>
        )}
      </section>
    </>
  );
}
type Draft = {
  name: string;
  slug: string;
  description: string;
  gender: string;
  categoryId: string;
  price: number;
  compareAtPrice: number | null;
  active: boolean;
  featured: boolean;
  images: { url: string; alt: string }[];
  variants: {
    id?: string;
    sku: string;
    size: string;
    color: string;
    stock: number;
    price: number | null;
  }[];
};
function ProductEditor({
  product,
  onClose,
}: {
  product: Product | null;
  onClose: () => void;
}) {
  const store = useStore();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    product
      ? {
          name: product.name,
          slug: product.slug,
          description: product.description,
          gender: product.gender,
          categoryId: product.categoryId,
          price: product.price,
          compareAtPrice: product.compareAtPrice,
          active: product.active,
          featured: product.featured,
          images: product.images.map((i) => ({ url: i.url, alt: i.alt })),
          variants: product.variants.map((v) => ({
            id: v.id,
            sku: v.sku,
            size: v.size,
            color: v.color,
            price: v.price,
            stock: v.inventory?.stock ?? 0,
          })),
        }
      : {
          name: "",
          slug: "",
          description: "",
          gender: "women",
          categoryId: store.data?.categories[0]?.id ?? "",
          price: 0,
          compareAtPrice: null,
          active: true,
          featured: false,
          images: [],
          variants: [
            { sku: "", size: "M", color: "Original", stock: 0, price: null },
          ],
        },
  );
  function field<K extends keyof Draft>(k: K, v: Draft[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
  }
  return (
    <section className="admin-panel editor-panel">
      <div className="section-heading">
        <h2>{product ? "Edit product" : "Add product"}</h2>
        <button
          className="icon-button"
          aria-label="Close product editor"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await send(
              product ? `/admin/products/${product.id}` : "/admin/products",
              draft,
              product ? "PUT" : "POST",
            );
            await qc.invalidateQueries({ queryKey: ["admin"] });
            await qc.invalidateQueries({ queryKey: ["products"] });
            await qc.invalidateQueries({ queryKey: ["product"] });
            toast("Product saved.");
            onClose();
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Name
            <input
              value={draft.name}
              required
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <label>
            URL slug
            <input
              value={draft.slug}
              required
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              onChange={(e) => field("slug", e.target.value)}
            />
          </label>
          <label className="full-width">
            Description
            <textarea
              value={draft.description}
              required
              minLength={10}
              onChange={(e) => field("description", e.target.value)}
            />
          </label>
          <label>
            Category
            <select
              value={draft.categoryId}
              onChange={(e) => field("categoryId", e.target.value)}
            >
              {store.data?.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Collection
            <select
              value={draft.gender}
              onChange={(e) => field("gender", e.target.value)}
            >
              <option value="women">Women</option>
              <option value="men">Men</option>
            </select>
          </label>
          <label>
            Price (LKR)
            <input
              type="number"
              step=".01"
              min=".01"
              required
              value={draft.price / 100 || ""}
              onChange={(e) =>
                field("price", Math.round(Number(e.target.value) * 100))
              }
            />
          </label>
          <label>
            Original price (optional, LKR)
            <input
              type="number"
              step=".01"
              value={draft.compareAtPrice ? draft.compareAtPrice / 100 : ""}
              onChange={(e) =>
                field(
                  "compareAtPrice",
                  e.target.value
                    ? Math.round(Number(e.target.value) * 100)
                    : null,
                )
              }
            />
          </label>
        </div>
        <div className="button-row">
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => field("active", e.target.checked)}
            />
            Visible in store
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={draft.featured}
              onChange={(e) => field("featured", e.target.checked)}
            />
            Feature on homepage
          </label>
        </div>
        <h3>Images</h3>
        <p className="small muted">
          The first image appears on the product card. JPEG, PNG, or WebP, up to
          8 MB each. Cloudinary credentials are required for new uploads.
        </p>
        <div className="editor-images">
          {draft.images.map((img, i) => (
            <div key={`${img.url}-${i}`}>
              <img src={img.url} alt={img.alt} />
              <label>
                Image description
                <input
                  value={img.alt}
                  required
                  onChange={(e) =>
                    field(
                      "images",
                      draft.images.map((x, n) =>
                        n === i ? { ...x, alt: e.target.value } : x,
                      ),
                    )
                  }
                />
              </label>
              <div className="button-row">
                <button
                  className="text-link"
                  type="button"
                  disabled={!i}
                  onClick={() => {
                    const images = [...draft.images];
                    [images[i - 1], images[i]] = [images[i], images[i - 1]];
                    field("images", images);
                  }}
                >
                  Move first
                </button>
                <button
                  className="text-link"
                  type="button"
                  onClick={() =>
                    field(
                      "images",
                      draft.images.filter((_, n) => n !== i),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
        <label className="upload-label">
          <Upload size={18} />
          Upload images
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              setBusy(true);
              try {
                const images = [];
                for (const file of files) {
                  const form = new FormData();
                  form.append("image", file);
                  const uploaded = await api<{ url: string }>(
                    "/admin/uploads",
                    { method: "POST", body: form },
                  );
                  images.push({
                    url: uploaded.url,
                    alt: draft.name || "Product image",
                  });
                }
                field("images", [...draft.images, ...images]);
              } catch (error) {
                toast((error as Error).message, true);
              } finally {
                setBusy(false);
                e.target.value = "";
              }
            }}
          />
        </label>
        <h3>Variants & inventory</h3>
        <p className="small muted">
          Stock means available units; reserved order quantities are tracked
          separately.
        </p>
        <div className="variant-editor">
          {draft.variants.map((v, i) => (
            <div className="variant-row" key={v.id ?? i}>
              {(["sku", "size", "color", "stock", "price"] as const).map(
                (k) => (
                  <label key={k}>
                    {k === "price"
                      ? "Price override (LKR)"
                      : k === "stock"
                        ? "Available stock"
                        : k.toUpperCase()}
                    <input
                      required={k !== "price"}
                      type={k === "stock" || k === "price" ? "number" : "text"}
                      min="0"
                      step={k === "price" ? ".01" : "1"}
                      value={
                        k === "price"
                          ? v.price === null
                            ? ""
                            : v.price / 100
                          : v[k]
                      }
                      onChange={(e) =>
                        field(
                          "variants",
                          draft.variants.map((x, n) =>
                            n === i
                              ? {
                                  ...x,
                                  [k]:
                                    k === "stock"
                                      ? Number(e.target.value)
                                      : k === "price"
                                        ? e.target.value
                                          ? Math.round(
                                              Number(e.target.value) * 100,
                                            )
                                          : null
                                        : e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </label>
                ),
              )}
              <button
                className="icon-button"
                type="button"
                aria-label="Remove variant"
                disabled={draft.variants.length <= 1}
                onClick={() =>
                  field(
                    "variants",
                    draft.variants.filter((_, n) => n !== i),
                  )
                }
              >
                <Trash2 size={17} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            field("variants", [
              ...draft.variants,
              { sku: "", size: "", color: "Original", stock: 0, price: null },
            ])
          }
        >
          <Plus size={16} />
          Add variant
        </button>
        <div className="editor-submit">
          <button className="button" disabled={busy}>
            {busy ? "Saving…" : "Save product"}
          </button>
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
function Products() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<Product | null | undefined>();
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery<ProductList>({
    queryKey: ["admin", "products", page, q],
    queryFn: () =>
      api(`/admin/products?page=${page}&q=${encodeURIComponent(q)}`),
  });
  if (editor !== undefined)
    return (
      <ProductEditor product={editor} onClose={() => setEditor(undefined)} />
    );
  return (
    <section className="admin-panel">
      <div className="section-heading">
        <h2>Products & inventory</h2>
        <button className="button" onClick={() => setEditor(null)}>
          <Plus size={16} />
          Add product
        </button>
      </div>
      <label>
        Search products
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <ErrorMessage error={data.error} />
      ) : (
        data.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Visible</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="admin-product-cell">
                        <img src={p.images[0]?.url} alt="" />
                        {p.name}
                      </td>
                      <td>{money(p.price)}</td>
                      <td>
                        {p.variants.reduce(
                          (s, v) => s + (v.inventory?.stock ?? 0),
                          0,
                        )}
                      </td>
                      <td>{p.active ? "Yes" : "Archived"}</td>
                      <td>
                        <div className="button-row">
                          <button
                            className="text-link"
                            onClick={() => setEditor(p)}
                          >
                            Edit
                          </button>
                          <button
                            className="text-link"
                            disabled={!p.active}
                            onClick={async () => {
                              try {
                                await api(`/admin/products/${p.id}`, {
                                  method: "DELETE",
                                });
                                qc.invalidateQueries({ queryKey: ["admin"] });
                                qc.invalidateQueries({
                                  queryKey: ["products"],
                                });
                                toast("Product archived.");
                              } catch (e) {
                                toast((e as Error).message, true);
                              }
                            }}
                          >
                            Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PageButtons data={data.data} onPage={setPage} />
          </>
        )
      )}
    </section>
  );
}
function Orders() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [selection, setSelection] = useState("");
  const [next, setNext] = useState("PROCESSING");
  const [tracking, setTracking] = useState("");
  const [refundReference, setRefund] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery<Paged<Order>>({
    queryKey: ["admin", "orders", page, q, status],
    queryFn: () =>
      api(
        `/admin/orders?page=${page}&q=${encodeURIComponent(q)}&status=${status}`,
      ),
  });
  return (
    <section className="admin-panel">
      <h2>Orders & fulfillment</h2>
      <div className="form-grid">
        <label>
          Search order or email
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Filter status
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All orders</option>
            {[
              "PENDING_PAYMENT",
              "CONFIRMED",
              "PROCESSING",
              "SHIPPED",
              "DELIVERED",
              "CANCELLED",
              "REFUND_PENDING",
              "REFUNDED",
              "PAYMENT_REVIEW",
            ].map((s) => (
              <option value={s} key={s}>
                {s.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <ErrorMessage error={data.error} />
      ) : (
        data.data && (
          <>
            <OrdersTable orders={data.data.items} />
            <PageButtons data={data.data} onPage={setPage} />
            <CashCollection
              key={selection}
              order={data.data.items.find((o) => o.id === selection)}
            />
            <h3>Update an order</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await send(
                    `/admin/orders/${selection}`,
                    { status: next, tracking, refundReference },
                    "PATCH",
                  );
                  qc.invalidateQueries({ queryKey: ["admin"] });
                  qc.invalidateQueries({ queryKey: ["order", selection] });
                  toast("Order updated.");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                <label>
                  Order
                  <select
                    required
                    value={selection}
                    onChange={(e) => setSelection(e.target.value)}
                  >
                    <option value="">Select an order</option>
                    {data.data.items.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.number} — {o.status.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  New status
                  <select
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                  >
                    {[
                      "PROCESSING",
                      "SHIPPED",
                      "DELIVERED",
                      "CANCELLED",
                      "REFUND_PENDING",
                      "REFUNDED",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s.toLowerCase().replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Tracking reference
                  <input
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                    required={next === "SHIPPED"}
                  />
                </label>
                <label>
                  Completed refund reference
                  <input
                    value={refundReference}
                    onChange={(e) => setRefund(e.target.value)}
                    required={next === "REFUNDED"}
                  />
                </label>
              </div>
              {["REFUND_PENDING", "REFUNDED"].includes(next) && (
                <p className="notice">
                  Complete the refund through the original payment method first:
                  PayHere for online payments, or a documented cash refund for
                  collected COD payments. Record its reference after completion.
                  This form records the operation; it does not transfer money.
                </p>
              )}
              <button className="button" disabled={busy || !selection}>
                {busy ? "Updating…" : "Update order"}
              </button>
            </form>
          </>
        )
      )}
    </section>
  );
}
function Customers() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState("");
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery<Paged<Customer>>({
    queryKey: ["admin", "customers", page, q],
    queryFn: () =>
      api(`/admin/customers?page=${page}&q=${encodeURIComponent(q)}`),
  });
  const history = useQuery<Order[]>({
    queryKey: ["admin", "customer-orders", selected],
    queryFn: () => api(`/admin/customers/${selected}/orders`),
    enabled: !!selected,
  });
  return (
    <section className="admin-panel">
      <h2>Customers</h2>
      <label>
        Search by name or email
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </label>
      {data.isPending ? (
        <Loading />
      ) : data.error ? (
        <ErrorMessage error={data.error} />
      ) : (
        data.data && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Verified</th>
                    <th>Orders</th>
                    <th>Account</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.data.items.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.email}</td>
                      <td>{c.verifiedAt ? "Yes" : "No"}</td>
                      <td>
                        <button
                          className="text-link"
                          onClick={() => setSelected(c.id)}
                        >
                          {c._count.orders} · View
                        </button>
                      </td>
                      <td>{c.active ? "Active" : "Disabled"}</td>
                      <td>
                        <button
                          className="text-link"
                          onClick={async () => {
                            try {
                              await send(
                                `/admin/customers/${c.id}`,
                                { active: !c.active },
                                "PATCH",
                              );
                              qc.invalidateQueries({
                                queryKey: ["admin", "customers"],
                              });
                              toast(
                                c.active
                                  ? "Customer disabled."
                                  : "Customer enabled.",
                              );
                            } catch (e) {
                              toast((e as Error).message, true);
                            }
                          }}
                        >
                          {c.active ? "Disable" : "Enable"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PageButtons data={data.data} onPage={setPage} />
          </>
        )
      )}
      {selected && (
        <>
          <h3>Customer order history</h3>
          {history.isPending ? (
            <Loading />
          ) : history.error ? (
            <ErrorMessage error={history.error} />
          ) : (
            <OrdersTable orders={history.data ?? []} />
          )}
        </>
      )}
    </section>
  );
}
function ResourceForm({
  title,
  endpoint,
  initial,
  categories,
  products,
  onClose,
}: {
  title: string;
  endpoint: string;
  initial: Record<string, unknown>;
  categories: Category[];
  products: Product[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const toast = useToast();
  const labels: Record<string, string> = {
    fee: "Delivery fee (minor units; 100 = LKR 1)",
    freeAbove: "Free delivery threshold (minor units)",
    minimum: "Minimum spend (minor units)",
    maximumDiscount: "Maximum discount (minor units, 0 = unlimited)",
    maxUses: "Maximum uses",
    parentId: "Parent category",
    href: "Destination URL",
    productIds: "Products in collection",
    image: "Image URL (imported media or Cloudinary)",
    expiresAt: "Expiry (ISO date and time)",
    percent: "Discount percentage",
  };
  return (
    <section className="admin-panel">
      <div className="section-heading">
        <h3>{title}</h3>
        <button
          className="icon-button"
          aria-label="Close editor"
          onClick={onClose}
        >
          <X />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await send(
              `/admin/${endpoint}`,
              draft,
              endpoint.includes("/") ? "PUT" : "POST",
            );
            qc.invalidateQueries({ queryKey: ["admin"] });
            qc.invalidateQueries({ queryKey: ["store"] });
            toast("Saved.");
            onClose();
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          {Object.entries(draft).map(([k, v]) =>
            typeof v === "boolean" ? (
              <label className="check-label" key={k}>
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [k]: e.target.checked }))
                  }
                />
                {k}
              </label>
            ) : k === "parentId" ? (
              <label key={k}>
                {labels[k]}
                <select
                  value={String(v ?? "")}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, [k]: e.target.value || null }))
                  }
                >
                  <option value="">None</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : k === "productIds" ? (
              <label key={k} className="full-width">
                {labels[k]}
                <select
                  multiple
                  size={8}
                  value={v as string[]}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [k]: Array.from(e.target.selectedOptions).map(
                        (o) => o.value,
                      ),
                    }))
                  }
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label
                key={k}
                className={k === "description" ? "full-width" : ""}
              >
                {labels[k] ?? k[0].toUpperCase() + k.slice(1)}
                <input
                  type={typeof v === "number" ? "number" : "text"}
                  value={String(v ?? "")}
                  required={k !== "description"}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      [k]:
                        typeof v === "number"
                          ? Number(e.target.value)
                          : e.target.value,
                    }))
                  }
                />
              </label>
            ),
          )}
        </div>
        <button className="button" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}
function StoreManagement() {
  const qc = useQueryClient();
  const toast = useToast();
  const data = useQuery<AdminStore>({
    queryKey: ["admin", "store"],
    queryFn: () => api("/admin/store"),
  });
  const products = useQuery<ProductList>({
    queryKey: ["admin", "collection-products"],
    queryFn: () => api("/products?limit=48"),
  });
  const [editor, setEditor] = useState<{
    title: string;
    endpoint: string;
    initial: Record<string, unknown>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  if (data.isPending) return <Loading />;
  if (data.error || !data.data) return <ErrorMessage error={data.error} />;
  const d = data.data;
  const s = settings ?? d.settings;
  const resources = [
    {
      name: "Shipping methods",
      endpoint: "shipping",
      items: d.shippingMethods as unknown as Record<string, unknown>[],
      defaults: {
        name: "",
        description: "",
        fee: 50000,
        freeAbove: 1500000,
        active: true,
      },
      keys: ["name", "description", "fee", "freeAbove", "active"],
    },
    {
      name: "Discount codes",
      endpoint: "coupons",
      items: d.coupons,
      defaults: {
        code: "",
        percent: 10,
        minimum: 0,
        maximumDiscount: 0,
        maxUses: 100,
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        active: true,
      },
      keys: [
        "code",
        "percent",
        "minimum",
        "maximumDiscount",
        "maxUses",
        "expiresAt",
        "active",
      ],
    },
    {
      name: "Categories",
      endpoint: "categories",
      items: d.categories as unknown as Record<string, unknown>[],
      defaults: { name: "", slug: "", parentId: null },
      keys: ["name", "slug", "parentId"],
    },
    {
      name: "Promotional banners",
      endpoint: "banners",
      items: d.banners,
      defaults: {
        title: "",
        description: "",
        image: "",
        href: "/shop",
        active: true,
      },
      keys: ["title", "description", "image", "href", "active"],
    },
    {
      name: "Homepage collections",
      endpoint: "collections",
      items: d.collections,
      defaults: {
        name: "",
        slug: "",
        description: "",
        image: "",
        active: true,
        productIds: [],
      },
      keys: ["name", "slug", "description", "image", "active", "productIds"],
    },
  ];
  return (
    <>
      {editor ? (
        <ResourceForm
          {...editor}
          categories={d.categories}
          products={products.data?.items ?? []}
          onClose={() => setEditor(null)}
        />
      ) : (
        <>
          <section className="admin-panel">
            <h2>Store settings & policies</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const { id, ...values } = s;
                try {
                  await send("/admin/settings", values, "PUT");
                  qc.invalidateQueries({ queryKey: ["admin", "store"] });
                  qc.invalidateQueries({ queryKey: ["store"] });
                  toast("Store settings saved.");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <div className="form-grid">
                {(
                  [
                    "storeName",
                    "supportEmail",
                    "announcement",
                    "taxBasisPoints",
                  ] as const
                ).map((k) => (
                  <label key={k}>
                    {
                      {
                        storeName: "Store name",
                        supportEmail: "Customer care email",
                        announcement: "Announcement bar",
                        taxBasisPoints: "Tax rate in basis points (100 = 1%)",
                      }[k]
                    }
                    <input
                      value={s[k]}
                      type={
                        k === "taxBasisPoints"
                          ? "number"
                          : k === "supportEmail"
                            ? "email"
                            : "text"
                      }
                      onChange={(e) =>
                        setSettings({
                          ...s,
                          [k]:
                            k === "taxBasisPoints"
                              ? Number(e.target.value)
                              : e.target.value,
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              {(
                ["privacy", "terms", "shippingPolicy", "returnsPolicy"] as const
              ).map((k) => (
                <label key={k}>
                  {
                    {
                      privacy: "Privacy policy",
                      terms: "Terms of service",
                      shippingPolicy: "Shipping policy",
                      returnsPolicy: "Returns policy",
                    }[k]
                  }
                  <textarea
                    rows={5}
                    value={s[k]}
                    onChange={(e) => setSettings({ ...s, [k]: e.target.value })}
                  />
                </label>
              ))}
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={s.policiesPublished}
                  onChange={(e) =>
                    setSettings({ ...s, policiesPublished: e.target.checked })
                  }
                />
                Publish policies after business/legal review
              </label>
              <button className="button" disabled={busy}>
                {busy ? "Saving…" : "Save store settings"}
              </button>
            </form>
          </section>
          {resources.map((r) => (
            <section className="admin-panel" key={r.endpoint}>
              <div className="section-heading">
                <h2>{r.name}</h2>
                <button
                  className="button secondary"
                  onClick={() =>
                    setEditor({
                      title: `Add ${r.name.toLowerCase()}`,
                      endpoint: r.endpoint,
                      initial: r.defaults,
                    })
                  }
                >
                  <Plus size={15} />
                  Add
                </button>
              </div>
              {r.items.length ? (
                r.items.map((item) => (
                  <div className="resource-row" key={String(item.id)}>
                    <span>
                      {String(item.name ?? item.title ?? item.code)}
                      {item.active === false ? " · Inactive" : ""}
                    </span>
                    <button
                      className="text-link"
                      onClick={() => {
                        const initial = Object.fromEntries(
                          r.keys.map((k) => [
                            k,
                            k === "productIds"
                              ? (
                                  (item.products as { productId: string }[]) ??
                                  []
                                ).map((p) => p.productId)
                              : item[k],
                          ]),
                        );
                        setEditor({
                          title: `Edit ${String(item.name ?? item.title ?? item.code)}`,
                          endpoint: `${r.endpoint}/${item.id}`,
                          initial,
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                ))
              ) : (
                <p className="muted">No entries yet.</p>
              )}
            </section>
          ))}
          <section className="admin-panel">
            <h2>Customer reviews</h2>
            {d.reviews.map((r) => (
              <article className="moderation-item" key={r.id}>
                <h3>
                  {r.title} · {r.rating}/5
                </h3>
                <small>
                  {r.user.name} / {r.product.name}
                </small>
                <p>{r.body}</p>
                <button
                  className="text-link"
                  onClick={async () => {
                    try {
                      await send(
                        `/admin/reviews/${r.id}`,
                        { approved: !r.approved },
                        "PATCH",
                      );
                      qc.invalidateQueries({ queryKey: ["admin", "store"] });
                      toast(r.approved ? "Review hidden." : "Review approved.");
                    } catch (e) {
                      toast((e as Error).message, true);
                    }
                  }}
                >
                  {r.approved ? "Hide review" : "Approve review"}
                </button>
              </article>
            ))}
            {!d.reviews.length && (
              <p className="muted">No customer reviews yet.</p>
            )}
          </section>
          <section className="admin-panel">
            <h2>Customer care inbox</h2>
            {d.messages.map((m) => (
              <article className="moderation-item" key={m.id}>
                <h3>{m.name}</h3>
                <a href={`mailto:${m.email}`}>{m.email}</a>
                <p>{m.body}</p>
                <button
                  className="text-link"
                  onClick={async () => {
                    try {
                      await send(
                        `/admin/messages/${m.id}`,
                        { resolved: !m.resolved },
                        "PATCH",
                      );
                      qc.invalidateQueries({ queryKey: ["admin", "store"] });
                    } catch (e) {
                      toast((e as Error).message, true);
                    }
                  }}
                >
                  {m.resolved ? "Reopen message" : "Mark resolved"}
                </button>
              </article>
            ))}
            {!d.messages.length && <p className="muted">No messages yet.</p>}
          </section>
        </>
      )}
    </>
  );
}
export default function Admin() {
  const session = useSession();
  const [tab, setTab] = useState("overview");
  if (session.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (!session.data?.user) return <Navigate to="/account/login" replace />;
  if (session.data.user.role !== "ADMIN")
    return (
      <div className="container page narrow">
        <h1>Administrator access required.</h1>
        <Link to="/account" className="button secondary">
          Back to my account
        </Link>
      </div>
    );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <p className="eyebrow">COZZY / STORE ADMIN</p>
        {[
          { id: "overview", label: "Overview", Icon: LayoutDashboard },
          { id: "products", label: "Products & stock", Icon: Package },
          { id: "orders", label: "Orders", Icon: ShoppingBag },
          { id: "customers", label: "Customers", Icon: Users },
          { id: "store", label: "Store management", Icon: SettingsIcon },
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
        <Link to="/">
          View storefront
          <ArrowUpRight size={16} />
        </Link>
      </aside>
      <div className="admin-content">
        <div className="admin-title">
          <p className="eyebrow">STORE OPERATIONS</p>
          <h1>
            {tab === "overview"
              ? "Your store, at a glance."
              : tab === "products"
                ? "The collection."
                : tab === "orders"
                  ? "Every order matters."
                  : tab === "customers"
                    ? "Your customers."
                    : "Make it yours."}
          </h1>
        </div>
        {tab === "overview" ? (
          <Dashboard />
        ) : tab === "products" ? (
          <Products />
        ) : tab === "orders" ? (
          <Orders />
        ) : tab === "customers" ? (
          <Customers />
        ) : (
          <StoreManagement />
        )}
      </div>
    </div>
  );
}

import { Link, useNavigate } from "react-router-dom";
import { Heart, Plus, ArrowUpRight } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, send, money, imageSet } from "../services/api";
import { useSession } from "../hooks/useStore";
import { useToast } from "./Feedback";
import type { Product } from "../types";
export function WishlistButton({ product }: { product: Product }) {
  const session = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const saved = useQuery<{ productId: string }[]>({
    queryKey: ["wishlist"],
    queryFn: () => api("/wishlist"),
    enabled: !!session.data?.user,
  });
  const selected = saved.data?.some((i) => i.productId === product.id);
  return (
    <button
      className={`icon-button wishlist-button ${selected ? "is-saved" : ""}`}
      aria-label={`${selected ? "Remove" : "Save"} ${product.name} ${selected ? "from" : "to"} wishlist`}
      aria-pressed={!!selected}
      disabled={busy}
      onClick={async () => {
        if (!session.data?.user) {
          navigate("/account/login");
          return;
        }
        setBusy(true);
        try {
          await send(
            `/wishlist/${product.id}`,
            {},
            selected ? "DELETE" : "PUT",
          );
          await qc.invalidateQueries({ queryKey: ["wishlist"] });
          toast(
            selected
              ? "Removed from your wishlist."
              : "Saved to your wishlist.",
          );
        } catch (e) {
          toast((e as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Heart size={18} fill={selected ? "currentColor" : "none"} />
    </button>
  );
}
export default function ProductCard({
  product,
  index = 0,
}: {
  product: Product;
  index?: number;
}) {
  const inStock = product.variants.some((v) => (v.inventory?.stock ?? 0) > 0);
  return (
    <article className="product-card">
      <div className="product-photo">
        <Link
          to={`/products/${product.slug}`}
          aria-label={`View ${product.name}`}
        >
          <img
            src={product.images[0]?.url}
            srcSet={imageSet(product.images[0]?.url ?? "")}
            sizes="(max-width: 600px) 50vw, (max-width: 1000px) 33vw, 25vw"
            alt={product.images[0]?.alt ?? product.name}
            loading={index < 4 ? "eager" : "lazy"}
            width="480"
            height="660"
          />
          {product.images[1] && (
            <img
              className="alternate"
              src={product.images[1].url}
              alt=""
              aria-hidden="true"
              loading="lazy"
              width="480"
              height="660"
            />
          )}
        </Link>
        <WishlistButton product={product} />
        {!inStock && <span className="product-label">Sold out</span>}
        <Link
          className="quick-view"
          to={`/products/${product.slug}`}
          aria-label={`Choose options for ${product.name}`}
        >
          <span>Choose your size</span>
          <Plus size={19} />
        </Link>
      </div>
      <div className="product-meta">
        <p className="eyebrow muted">{product.category.name}</p>
        <Link className="product-name" to={`/products/${product.slug}`}>
          {product.name}
        </Link>
        <div className="product-price">
          {money(product.price)}
          {product.compareAtPrice && <del>{money(product.compareAtPrice)}</del>}
        </div>
        <span className="product-colors">
          {[...new Set(product.variants.map((v) => v.color))].join(" · ")}
        </span>
      </div>
    </article>
  );
}
export function SectionHeading({
  kicker,
  title,
  href,
  action = "View all",
}: {
  kicker: string;
  title: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <p className="eyebrow">{kicker}</p>
        <h2>{title}</h2>
      </div>
      {href && (
        <Link className="text-link" to={href}>
          {action}
          <ArrowUpRight size={18} />
        </Link>
      )}
    </div>
  );
}

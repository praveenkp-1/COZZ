import { useParams, Link } from "react-router-dom";
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Star,
  Plus,
  Minus,
  ArrowUpRight,
  ZoomIn,
  X,
  Truck,
  ShieldCheck,
} from "lucide-react";
import { reviewSchema } from "../../../shared/contracts";
import {
  useProduct,
  useProducts,
  useCart,
  useCartUpdate,
  useSession,
} from "../hooks/useStore";
import ProductCard, {
  WishlistButton,
  SectionHeading,
} from "../components/ProductCard";
import { ErrorMessage, Loading, useToast } from "../components/Feedback";
import { money, imageSet, send } from "../services/api";
export default function ProductPage() {
  const { slug = "" } = useParams();
  const product = useProduct(slug);
  const related = useProducts(`gender=${product.data?.gender ?? ""}&limit=5`);
  const session = useSession();
  const cart = useCart();
  const add = useCartUpdate();
  const toast = useToast();
  const [image, setImage] = useState(0);
  const [size, setSize] = useState("");
  const [color, setColor] = useState("");
  const [quantity, setQuantity] = useState(1);
  const zoom = useRef<HTMLDialogElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
  const review = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: { rating: 5, title: "", body: "" },
  });
  if (product.isPending)
    return (
      <div className="container page">
        <Loading />
      </div>
    );
  if (product.error || !product.data)
    return (
      <div className="container page">
        <ErrorMessage error={product.error} />
      </div>
    );
  const p = product.data;
  const colors = [...new Set(p.variants.map((v) => v.color))];
  const selectedColor = color || colors[0];
  const sizes = [
    ...new Set(
      p.variants.filter((v) => v.color === selectedColor).map((v) => v.size),
    ),
  ];
  const variant = p.variants.find(
    (v) => v.size === size && v.color === selectedColor,
  );
  const stock = variant?.inventory?.stock ?? 0;
  const currentImage = p.images[Math.min(image, p.images.length - 1)];
  return (
    <div className="container page">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <Link to={`/shop?gender=${p.gender}`}>
          {p.gender === "men" ? "Men" : "Women"}
        </Link>
        <span>/</span>
        <span>{p.name.toLowerCase()}</span>
      </div>
      <div className="product-detail">
        <div className="gallery">
          <button
            className="gallery-main"
            aria-label="Zoom product image"
            onClick={() => zoom.current?.showModal()}
          >
            <img
              src={currentImage.url}
              srcSet={imageSet(currentImage.url)}
              sizes="(max-width: 768px) 100vw, 50vw"
              alt={currentImage.alt}
              width="960"
              height="1300"
            />
            <span>
              <ZoomIn size={20} />
            </span>
          </button>
          <div className="gallery-thumbs">
            {p.images.map((img, i) => (
              <button
                key={img.url}
                className={image === i ? "selected" : ""}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={image === i}
                onClick={() => setImage(i)}
              >
                <img
                  src={img.url}
                  alt={img.alt}
                  loading="lazy"
                  width="80"
                  height="100"
                />
              </button>
            ))}
          </div>
        </div>
        <div className="product-info">
          <p className="eyebrow">{p.category.name} / THE COZZY COLLECTION</p>
          <h1>{p.name.toLowerCase()}</h1>
          <div className="detail-price">
            {money(variant?.price ?? p.price)}
            {p.compareAtPrice && <del>{money(p.compareAtPrice)}</del>}
          </div>
          {p.reviewCount ? (
            <a className="review-link" href="#reviews">
              <Star size={15} fill="currentColor" />
              {p.rating?.toFixed(1)} · {p.reviewCount} reviews
            </a>
          ) : (
            <a className="review-link muted" href="#reviews">
              No reviews yet
            </a>
          )}
          <p className="product-description">{p.description}</p>
          <div className="variant-section">
            <span>
              Color: <strong>{selectedColor}</strong>
            </span>
            <div className="option-buttons">
              {colors.map((c) => (
                <button
                  className={selectedColor === c ? "selected" : ""}
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setSize("");
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="size-heading">
              <span>
                Size: <strong>{size || "Select your size"}</strong>
              </span>
              <button
                className="text-link"
                onClick={() => guide.current?.showModal()}
              >
                Size guide
                <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="option-buttons size-buttons">
              {sizes.map((s) => {
                const available = p.variants.some(
                  (v) =>
                    v.size === s &&
                    v.color === selectedColor &&
                    (v.inventory?.stock ?? 0) > 0,
                );
                return (
                  <button
                    className={size === s ? "selected" : ""}
                    key={s}
                    disabled={!available}
                    aria-pressed={size === s}
                    onClick={() => {
                      setSize(s);
                      setQuantity(1);
                    }}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <p className="stock-note">
              {variant
                ? stock > 0
                  ? `${stock} available`
                  : "Currently sold out"
                : p.variants.some((v) => (v.inventory?.stock ?? 0) > 0)
                  ? "Choose a size to check availability."
                  : "This piece is currently sold out."}
            </p>
          </div>
          <div className="add-to-bag">
            <div className="quantity-control">
              <button
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => q - 1)}
              >
                <Minus size={15} />
              </button>
              <span>{quantity}</span>
              <button
                aria-label="Increase quantity"
                disabled={quantity >= Math.min(10, stock)}
                onClick={() => setQuantity((q) => q + 1)}
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              className="button"
              disabled={!variant || !stock || add.isPending || !cart.data}
              onClick={async () => {
                if (!variant) return;
                try {
                  const existing =
                    cart.data?.items.find((i) => i.variantId === variant.id)
                      ?.quantity ?? 0;
                  await add.mutateAsync({
                    variantId: variant.id,
                    quantity: Math.min(10, existing + quantity),
                  });
                  toast("Added to your bag.");
                } catch (e) {
                  toast((e as Error).message, true);
                }
              }}
            >
              {add.isPending ? "Adding…" : "Add to bag"}
              <Plus size={17} />
            </button>
            <WishlistButton product={p} />
          </div>
          <div className="product-assurances">
            <span>
              <Truck size={17} />
              Delivery calculated at checkout
            </span>
            <span>
              <ShieldCheck size={17} />
              Secure payment with PayHere
            </span>
          </div>
          <details className="detail-accordion">
            <summary>Product details</summary>
            <p>{p.description}</p>
            <p>Available sizes: {sizes.join(", ")}.</p>
          </details>
          <details className="detail-accordion">
            <summary>Shipping & returns</summary>
            <p>
              <Link to="/policies/shipping">Read shipping information</Link> and
              our <Link to="/policies/returns">returns policy</Link>. Contact
              customer care with any questions before ordering.
            </p>
          </details>
        </div>
      </div>
      <section className="reviews section" id="reviews">
        <SectionHeading
          kicker="FROM THE COZZY COMMUNITY"
          title="Customer reviews"
        />
        {p.reviews?.length ? (
          <div className="review-grid">
            {p.reviews.map((r) => (
              <article key={r.id}>
                <p
                  className="review-stars"
                  aria-label={`${r.rating} out of 5 stars`}
                >
                  {"★".repeat(r.rating)}
                  {"☆".repeat(5 - r.rating)}
                </p>
                <h3>{r.title}</h3>
                <p>{r.body}</p>
                <small>{r.user.name} · Verified purchase</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">
            No reviews yet. Verified customers can leave a review after
            delivery.
          </p>
        )}
        {session.data?.user && (
          <details className="review-form">
            <summary>Write a review</summary>
            <form
              onSubmit={review.handleSubmit(async (values) => {
                try {
                  const r = await send<{ message: string }>(
                    `/products/${p.id}/reviews`,
                    values,
                  );
                  toast(r.message);
                  review.reset();
                } catch (e) {
                  toast((e as Error).message, true);
                }
              })}
            >
              <label>
                Rating
                <select {...review.register("rating", { valueAsNumber: true })}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option value={n} key={n}>
                      {n} stars
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Title
                <input {...review.register("title")} />
              </label>
              <label>
                Your review
                <textarea {...review.register("body")} />
              </label>
              {Object.values(review.formState.errors).map((e, i) => (
                <p className="field-error" key={i}>
                  {e.message}
                </p>
              ))}
              <button
                className="button"
                disabled={review.formState.isSubmitting}
              >
                Submit review
              </button>
            </form>
          </details>
        )}
      </section>
      <section className="section">
        <SectionHeading
          kicker="COMPLETE YOUR EDIT"
          title="You may also like"
          href={`/shop?gender=${p.gender}`}
        />
        <div className="product-grid">
          {related.data?.items
            .filter((x) => x.id !== p.id)
            .slice(0, 4)
            .map((x) => (
              <ProductCard product={x} key={x.id} />
            ))}
        </div>
      </section>
      <dialog
        ref={zoom}
        className="zoom-dialog"
        aria-label="Product image zoom"
        onClick={(e) => {
          if (e.target === e.currentTarget) zoom.current?.close();
        }}
      >
        <button
          className="icon-button dialog-close"
          aria-label="Close image"
          onClick={() => zoom.current?.close()}
        >
          <X />
        </button>
        <img src={currentImage.url} alt={currentImage.alt} />
      </dialog>
      <dialog
        ref={guide}
        className="guide-dialog"
        aria-labelledby="size-guide-title"
      >
        <button
          className="icon-button dialog-close"
          aria-label="Close size guide"
          onClick={() => guide.current?.close()}
        >
          <X />
        </button>
        <h2 id="size-guide-title">Finding your fit</h2>
        <p>
          This piece is offered in {sizes.join(", ")}. Garment measurements vary
          by style.
        </p>
        <p>
          For precise measurements and fit advice, contact customer care with
          the product name and your usual size before ordering.
        </p>
        <Link
          className="button secondary"
          to="/contact"
          onClick={() => guide.current?.close()}
        >
          Ask about sizing
        </Link>
      </dialog>
    </div>
  );
}

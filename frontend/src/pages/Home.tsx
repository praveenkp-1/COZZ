import { Link } from "react-router-dom";
import { ArrowUpRight, Truck, Heart, ShieldCheck } from "lucide-react";
import {
  EditorialHero,
  FeaturedCollectionPanels,
} from "../components/HomepageEditorial";
import { useProducts, useStore } from "../hooks/useStore";
import ProductCard, { SectionHeading } from "../components/ProductCard";
import { Loading, ErrorMessage } from "../components/Feedback";
import { imageSet } from "../services/api";
export default function Home() {
  const products = useProducts("featured=true&limit=8");
  const popular = useProducts("sort=popular&limit=4");
  const store = useStore();
  return (
    <>
      <EditorialHero />
      <FeaturedCollectionPanels />
      <div className="brand-strip">
        <span>Considered style</span>
        <i>✦</i>
        <span>Everyday favorites</span>
        <i>✦</i>
        <span>Made for your wardrobe</span>
        <i>✦</i>
        <span>Uniquely you</span>
      </div>
      <section className="container section" id="new-arrivals">
        <SectionHeading
          kicker="FRESH PERSPECTIVES"
          title="New arrivals"
          href="/shop?featured=true"
          action="Explore new arrivals"
        />
        {products.isPending ? (
          <Loading cards />
        ) : products.error ? (
          <ErrorMessage
            error={products.error}
            retry={() => products.refetch()}
          />
        ) : (
          <div className="product-grid">
            {products.data?.items.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        )}
      </section>
      <section
        className="container section collection-section"
        id="store-collections"
      >
        <SectionHeading
          kicker="YOUR STYLE STARTS HERE"
          title="Find your collection"
        />
        {store.error ? (
          <ErrorMessage error={store.error} />
        ) : (
          <div className="collection-grid">
            {store.data?.collections.map((c) => (
              <Link
                to={`/shop?collection=${c.slug}`}
                key={c.id}
                className="collection-card"
              >
                <img
                  src={c.image}
                  srcSet={imageSet(c.image)}
                  sizes="(max-width: 640px) 100vw, 50vw"
                  alt={`${c.name} collection`}
                  loading="lazy"
                  width="700"
                  height="800"
                />
                <div className="collection-caption">
                  <div>
                    <p className="eyebrow">THE COZZY EDIT</p>
                    <h3>{c.name}</h3>
                    <p>{c.description}</p>
                  </div>
                  <span className="circle-arrow">
                    <ArrowUpRight />
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
      {popular.data?.items.some((p) => p.salesCount > 0) && (
        <section className="container section">
          <SectionHeading
            kicker="THE PIECES YOU LOVE"
            title="Bestsellers"
            href="/shop?sort=popular"
          />
          <div className="product-grid">
            {popular.data.items
              .filter((p) => p.salesCount > 0)
              .map((p) => (
                <ProductCard product={p} key={p.id} />
              ))}
          </div>
        </section>
      )}
      {store.data?.banners.map((b) => (
        <section className="container section" key={b.id}>
          <Link to={b.href} className="promo-banner">
            <img src={b.image} alt="" loading="lazy" />
            <div>
              <p className="eyebrow">THE LATEST FROM COZZY</p>
              <h2>{b.title}</h2>
              <p>{b.description}</p>
              <span className="text-link">
                Explore the edit
                <ArrowUpRight />
              </span>
            </div>
          </Link>
        </section>
      ))}
      <section className="brand-note container" id="about-cozzy">
        <p className="eyebrow">A WARDROBE THAT FEELS LIKE YOU</p>
        <h2>
          Good style is personal.
          <br />
          <em>Make room for yours.</em>
        </h2>
        <Link className="text-link" to="/shop">
          Discover COZZY
          <ArrowUpRight size={18} />
        </Link>
      </section>
      <div className="benefit-strip container">
        <div>
          <Truck />
          <span>
            <strong>Islandwide delivery</strong>
            <small>Shipping calculated at checkout</small>
          </span>
        </div>
        <div>
          <Heart />
          <span>
            <strong>Keep your favorites close</strong>
            <small>A wishlist made for your style</small>
          </span>
        </div>
        <div>
          <ShieldCheck />
          <span>
            <strong>A secure shopping experience</strong>
            <small>Protected payments with PayHere</small>
          </span>
        </div>
      </div>
    </>
  );
}

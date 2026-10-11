import { Link } from "react-router-dom";
import { ArrowRight, Heart, Truck, Headphones } from "lucide-react";

const panels = [
  {
    key: "women",
    image: "/images/hero/women-collection.webp",
    alt: "Women's collection campaign in warm stone architecture",
    heading: (
      <>
        Women's
        <br />
        Collection
      </>
    ),
    description: "Modern, bold and effortlessly you.",
    action: "Shop Women",
    href: "/shop?gender=women",
    season: "NEW SEASON",
  },
  {
    key: "men",
    image: "/images/hero/men-collection.webp",
    alt: "Men's collection campaign with a black overshirt and everyday essentials",
    heading: (
      <>
        Men's
        <br />
        Collection
      </>
    ),
    description: "Street style meets everyday comfort.",
    action: "Shop Men",
    href: "/shop?gender=men",
    season: "NEW SEASON",
  },
  {
    key: "arrivals",
    image: "/images/hero/new-arrivals.webp",
    alt: "Sunlit stone terraces overlooking the sea for the new season",
    heading: (
      <>
        New
        <br />
        Arrivals
      </>
    ),
    description: "Fresh styles for the new season.",
    action: "Shop Now",
    href: "/shop?featured=true",
    season: "LATEST DROP",
  },
];

export function EditorialHero() {
  return (
    <section className="hero editorial-hero" aria-labelledby="campaign-heading">
      <img
        className="hero-image"
        src="/images/hero/hero-main.webp"
        alt="COZZY fashion campaign with two models in warm neutral layers"
        fetchPriority="high"
        width="1783"
        height="882"
      />
      <div className="hero-shade" aria-hidden="true" />
      <div className="editorial-hero-content">
        <p className="eyebrow hero-eyebrow">NEW SEASON</p>
        <h1 id="campaign-heading">
          Redefine
          <br />
          <em>Your</em> Style
        </h1>
        <p className="hero-description">
          Modern essentials for a bolder you. Premium quality, minimal design,
          and everyday comfort.
        </p>
        <div className="hero-buttons">
          <Link className="button light" to="/shop?featured=true">
            Shop New Arrivals <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <Link className="hero-secondary" to="/#collections">
            <span className="hero-secondary-icon" aria-hidden="true">
              <ArrowRight size={18} />
            </span>
            Explore collections
          </Link>
        </div>
        <nav className="hero-services" aria-label="Shopping services">
          <Link to="/wishlist">
            <Heart aria-hidden="true" />
            <span>
              Your saved
              <br />
              favorites
            </span>
          </Link>
          <Link to="/policies/shipping">
            <Truck aria-hidden="true" />
            <span>
              Delivery at
              <br />
              checkout
            </span>
          </Link>
          <Link to="/contact">
            <Headphones aria-hidden="true" />
            <span>
              Customer
              <br />
              care
            </span>
          </Link>
        </nav>
      </div>
    </section>
  );
}

export function FeaturedCollectionPanels() {
  return (
    <section
      className="featured-collections"
      id="collections"
      aria-label="Featured collections"
    >
      {panels.map((panel) => (
        <article
          className={`editorial-panel editorial-panel-${panel.key}`}
          key={panel.key}
        >
          <img
            src={panel.image}
            alt={panel.alt}
            loading="lazy"
            decoding="async"
            width={
              panel.key === "women" ? 807 : panel.key === "men" ? 908 : 975
            }
            height={panel.key === "women" ? 396 : 428}
          />
          <div className="editorial-panel-shade" aria-hidden="true" />
          <div className="editorial-panel-content">
            <h2>{panel.heading}</h2>
            <p>{panel.description}</p>
            <Link
              className={`button ${panel.key === "men" ? "light" : ""}`}
              to={panel.href}
            >
              {panel.action} <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
          <span className="editorial-panel-season">
            {panel.season}
            <span aria-hidden="true" />
          </span>
        </article>
      ))}
    </section>
  );
}

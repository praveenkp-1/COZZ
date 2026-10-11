import { useState, useEffect, useRef } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  UserRound,
  Heart,
  ShoppingBag,
  Menu,
  X,
  ArrowRight,
  Mail,
  ShieldCheck,
  MoveUpRight,
} from "lucide-react";
import { useStore, useCart, useSession } from "../hooks/useStore";
import { api, send } from "../services/api";
import { useToast } from "./Feedback";

export function Header() {
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const home = location.pathname === "/";
  const session = useSession();
  const cart = useCart();
  const store = useStore();
  const wishlist = useQuery<{ productId: string }[]>({
    queryKey: ["wishlist"],
    queryFn: () => api("/wishlist"),
    enabled: home && !!session.data?.user,
  });
  const bagCount =
    cart.data?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  const wishlistCount = wishlist.data?.length ?? 0;
  const announcement = store.data?.settings.announcement;
  // The campaign replaces the default tagline; custom store announcements remain visible.
  const showAnnouncement =
    !home ||
    (!!announcement?.trim() &&
      announcement.trim() !== "Step into the world of fashion");
  const menuRef = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setMenu(false);
    setSearch(false);
  }, [location.pathname, location.search, location.hash]);

  useEffect(() => {
    if (!home) return;
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [home]);

  useEffect(() => {
    if (!menu) return;
    const links = menuRef.current?.querySelectorAll<HTMLElement>("a,button");
    links?.[0]?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenu(false);
        menuButton.current?.focus();
      }
      if (e.key === "Tab" && links?.length) {
        const first = links[0],
          last = links[links.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [menu]);

  function searchProducts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    navigate("/shop?q=" + encodeURIComponent(q.trim()));
    setSearch(false);
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {showAnnouncement && (
        <div className={`announcement${home ? " homepage-announcement" : ""}`}>
          <span>{announcement ?? "Step into the world of fashion"}</span>
          <span className="announcement-right" />
        </div>
      )}
      <header
        className={`site-header${home ? " homepage-header" : ""}${home && scrolled ? " is-scrolled" : ""}${home && showAnnouncement ? " has-announcement" : ""}`}
      >
        <div className="header-inner">
          <button
            ref={menuButton}
            className="icon-button mobile-menu-button"
            aria-label="Open navigation"
            aria-expanded={menu}
            aria-controls="mobile-navigation"
            onClick={() => setMenu((value) => !value)}
          >
            <Menu size={22} />
          </button>
          <Link className="brand" to="/" aria-label="COZZY home">
            <img
              src={home ? "/media/logo-light.webp" : "/media/logo-dark.webp"}
              alt="COZZY"
              width="112"
              height="56"
            />
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            <NavLink to="/" end>
              Home
            </NavLink>
            {home ? (
              <>
                <NavLink to="/shop">Shop</NavLink>
                <Link to="/shop?gender=women">Women</Link>
                <Link to="/shop?gender=men">Men</Link>
                <Link to="/shop?featured=true">New Arrivals</Link>
                <Link to="/#collections">Collections</Link>
                <Link to="/#about-cozzy">About</Link>
              </>
            ) : (
              <>
                <NavLink to="/shop">Shop all</NavLink>
                <Link to="/shop?gender=women">Women</Link>
                <Link to="/shop?gender=men">Men</Link>
                <NavLink to="/contact">Contact us</NavLink>
              </>
            )}
          </nav>
          <div className="header-actions">
            {home && (
              <form
                className="homepage-search"
                role="search"
                aria-label="Header product search"
                onSubmit={searchProducts}
              >
                <Search size={17} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Search for products"
                  placeholder="Search for products..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  maxLength={100}
                />
                <button className="sr-only" type="submit">
                  Search
                </button>
              </form>
            )}
            <button
              ref={searchButton}
              className="icon-button search-toggle"
              aria-label="Search products"
              aria-expanded={search}
              aria-controls="header-product-search"
              onClick={() => setSearch((value) => !value)}
            >
              {search ? <X size={20} /> : <Search size={20} />}
            </button>
            <Link
              className="icon-button account-icon"
              to={session.data?.user ? "/account" : "/account/login"}
              aria-label="My account"
            >
              <UserRound size={home ? 25 : 20} />
            </Link>
            <Link
              className="icon-button wishlist-icon"
              to="/wishlist"
              aria-label={
                home ? `Wishlist, ${wishlistCount} items` : "Wishlist"
              }
            >
              <Heart size={home ? 25 : 20} />
              {home && (
                <span className="header-count" aria-hidden="true">
                  {wishlistCount}
                </span>
              )}
            </Link>
            <Link
              className="icon-button bag-link"
              to="/cart"
              aria-label={`Shopping bag, ${bagCount} items`}
            >
              <ShoppingBag size={home ? 25 : 20} />
              <span
                className={home ? "header-count" : undefined}
                aria-hidden="true"
              >
                {bagCount}
              </span>
            </Link>
          </div>
        </div>
        {search && (
          <form
            id="header-product-search"
            className="header-search container"
            role="search"
            onSubmit={searchProducts}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch(false);
                searchButton.current?.focus();
              }
            }}
          >
            <label className="sr-only" htmlFor="header-search">
              Search the collection
            </label>
            <input
              id="header-search"
              type="search"
              placeholder="Find your next favorite…"
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={100}
            />
            <button className="icon-button" aria-label="Submit search">
              <ArrowRight size={22} />
            </button>
          </form>
        )}
      </header>
      {menu && (
        <div
          className={`mobile-backdrop${home ? " homepage-navigation" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          onClick={() => {
            setMenu(false);
            menuButton.current?.focus();
          }}
        >
          <nav
            ref={menuRef}
            id="mobile-navigation"
            className="mobile-navigation"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button mobile-close"
              aria-label="Close navigation"
              onClick={() => {
                setMenu(false);
                menuButton.current?.focus();
              }}
            >
              <X />
            </button>
            <Link to="/">Home</Link>
            <Link to="/shop">{home ? "Shop" : "Shop all"}</Link>
            <Link to="/shop?gender=women">Women</Link>
            <Link to="/shop?gender=men">Men</Link>
            {home && (
              <>
                <Link to="/shop?featured=true">New Arrivals</Link>
                <Link to="/#collections">Collections</Link>
                <Link to="/#about-cozzy">About</Link>
              </>
            )}
            <Link to="/wishlist">Wishlist</Link>
            <Link to="/account">My account</Link>
            <Link to="/contact">Contact us</Link>
          </nav>
        </div>
      )}
    </>
  );
}
export function Footer() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const toast = useToast();
  const store = useStore();
  return (
    <footer className="site-footer">
      <div className="newsletter container">
        <div>
          <p className="eyebrow">THE COZZY LETTER</p>
          <h2>
            A little style.
            <br />
            Straight to your inbox.
          </h2>
          <p>New arrivals, fresh inspiration, and the latest from COZZY.</p>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await send<{ message: string }>("/newsletter", {
                email,
                consent,
              });
              toast(r.message);
              setEmail("");
              setConsent(false);
            } catch (e) {
              toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label htmlFor="newsletter-email">Your email address</label>
          <div className="newsletter-input">
            <input
              id="newsletter-email"
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button aria-label="Subscribe to newsletter" disabled={busy}>
              {busy ? "Sending…" : <ArrowRight size={24} />}
            </button>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              required
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I agree to receive emails and accept the{" "}
              <Link to="/policies/privacy">privacy policy</Link>.
            </span>
          </label>
        </form>
      </div>
      <div className="footer-main container">
        <div className="footer-brand">
          <Link to="/" aria-label="COZZY home">
            <img
              src="/media/logo-dark.webp"
              alt="COZZY"
              width="145"
              height="70"
              loading="lazy"
            />
          </Link>
          <p>
            Step into the world of fashion.
            <br />
            Find the pieces that feel like you.
          </p>
        </div>
        <div>
          <h3>Explore</h3>
          <Link to="/shop">All clothing</Link>
          <Link to="/shop?gender=women">Women</Link>
          <Link to="/shop?gender=men">Men</Link>
          <Link to="/shop?featured=true">New arrivals</Link>
        </div>
        <div>
          <h3>Customer care</h3>
          <Link to="/contact">Contact us</Link>
          <Link to="/policies/shipping">Shipping & delivery</Link>
          <Link to="/policies/returns">Returns & exchanges</Link>
          <Link to="/account">My orders</Link>
        </div>
        <div>
          <h3>Stay connected</h3>
          {store.data?.settings.supportEmail ? (
            <a href={`mailto:${store.data.settings.supportEmail}`}>
              <Mail size={15} />
              {store.data.settings.supportEmail}
            </a>
          ) : (
            <Link to="/contact">
              Talk to customer care
              <MoveUpRight size={15} />
            </Link>
          )}
          <Link to="/policies/privacy">Privacy policy</Link>
          <Link to="/policies/terms">Terms of service</Link>
        </div>
      </div>
      <div className="footer-bottom container">
        <span>© {new Date().getFullYear()} COZZY. Created by KP.</span>
        <span>
          <ShieldCheck size={15} />
          Secure checkout with PayHere
        </span>
      </div>
    </footer>
  );
}
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) {
      target.scrollIntoView({ behavior: "instant" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    const main = document.getElementById("main");
    main?.focus({ preventScroll: true });
  }, [pathname, hash]);
  return null;
}

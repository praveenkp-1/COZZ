import { useParams, Link } from "react-router-dom";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, ArrowUpRight, Mail } from "lucide-react";
import { useSession, useStore } from "../hooks/useStore";
import { api, send } from "../services/api";
import { Loading, ErrorMessage, useToast } from "../components/Feedback";
import ProductCard from "../components/ProductCard";
import type { Product } from "../types";
export function Wishlist() {
  const session = useSession();
  const saved = useQuery<{ product: Product }[]>({
    queryKey: ["wishlist"],
    queryFn: () => api("/wishlist"),
    enabled: !!session.data?.user,
  });
  return (
    <div className="container page">
      <div className="page-heading">
        <p className="eyebrow">KEEP YOUR FAVORITES CLOSE</p>
        <h1>Your wishlist</h1>
      </div>
      {session.isPending ? (
        <Loading />
      ) : !session.data?.user ? (
        <div className="empty-state">
          <Heart size={40} />
          <h2>A space for everything you love.</h2>
          <p>Sign in to save your favorites across devices.</p>
          <Link className="button" to="/account/login">
            Sign in
            <ArrowUpRight size={17} />
          </Link>
        </div>
      ) : saved.isPending ? (
        <Loading cards />
      ) : saved.error ? (
        <ErrorMessage error={saved.error} />
      ) : saved.data?.length ? (
        <div className="product-grid">
          {saved.data.map((i) => (
            <ProductCard key={i.product.id} product={i.product} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <Heart size={40} />
          <h2>Your next favorite is out there.</h2>
          <p>Tap the heart on a piece to save it here.</p>
          <Link className="button" to="/shop">
            Explore the collection
          </Link>
        </div>
      )}
    </div>
  );
}
export function Contact() {
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const store = useStore();
  return (
    <div className="container page contact-layout">
      <div>
        <p className="eyebrow">LET’S TALK</p>
        <h1>
          A little help.
          <br />A human touch.
        </h1>
        <p>
          Questions about a piece, sizing, or an order?
          <br />
          Leave a message for the COZZY team.
        </p>
        {store.data?.settings.supportEmail && (
          <a
            className="text-link"
            href={`mailto:${store.data.settings.supportEmail}`}
          >
            <Mail size={18} />
            {store.data.settings.supportEmail}
          </a>
        )}
        <div className="contact-links">
          <Link to="/policies/shipping">
            Shipping information
            <ArrowUpRight size={16} />
          </Link>
          <Link to="/policies/returns">
            Returns & exchanges
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
      <form
        className="contact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await send<{ message: string }>("/contact", {
              name,
              email,
              body,
            });
            toast(r.message);
            setBody("");
          } catch (e) {
            toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Your name
          <input
            required
            minLength={2}
            maxLength={100}
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Email address
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Your message
          <textarea
            required
            minLength={10}
            maxLength={4000}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <button className="button" disabled={busy}>
          {busy ? "Sending…" : "Send message"}
          <ArrowUpRight size={18} />
        </button>
        <p className="small muted">
          Messages are handled according to our{" "}
          <Link to="/policies/privacy">privacy policy</Link>.
        </p>
      </form>
    </div>
  );
}
export function Policy() {
  const { kind = "" } = useParams();
  const store = useStore();
  const mapping: Record<
    string,
    {
      title: string;
      key: "privacy" | "terms" | "shippingPolicy" | "returnsPolicy";
    }
  > = {
    privacy: { title: "Privacy policy", key: "privacy" },
    terms: { title: "Terms of service", key: "terms" },
    shipping: { title: "Shipping & delivery", key: "shippingPolicy" },
    returns: { title: "Returns & exchanges", key: "returnsPolicy" },
  };
  const page = mapping[kind];
  if (!page) return <NotFound />;
  return (
    <div className="container page policy-page">
      <p className="eyebrow">CUSTOMER CARE</p>
      <h1>{page.title}</h1>
      {store.isPending ? (
        <Loading />
      ) : store.error ? (
        <ErrorMessage error={store.error} />
      ) : store.data?.settings.policiesPublished &&
        store.data.settings[page.key] ? (
        <div className="policy-text">{store.data.settings[page.key]}</div>
      ) : (
        <p>
          Store policy information is awaiting publication.{" "}
          <Link to="/contact">Contact customer care</Link> for details before
          ordering.
        </p>
      )}
    </div>
  );
}
export function NotFound() {
  return (
    <div className="container page empty-state">
      <p className="eyebrow">404 / A DIFFERENT DIRECTION</p>
      <h1>This page has wandered off.</h1>
      <p>Let’s get you back to something you love.</p>
      <Link className="button" to="/shop">
        Explore the collection
        <ArrowUpRight size={18} />
      </Link>
    </div>
  );
}

import { lazy, Suspense, useEffect } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Catalog from "./pages/Catalog";
import ProductPage from "./pages/Product";
import { Header, Footer, ScrollToTop } from "./components/Layout";
import { ToastProvider, Loading, ErrorBoundary } from "./components/Feedback";
import { Contact, Policy, NotFound, Wishlist } from "./pages/Info";
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Account = lazy(() => import("./pages/Account"));
const Orders = lazy(() => import("./pages/Orders"));
const Admin = lazy(() => import("./pages/Admin"));
const TokenAction = lazy(() =>
  import("./pages/Account").then((m) => ({ default: m.TokenAction })),
);
function Metadata() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname;
    const label =
      path === "/"
        ? "Step into the world of fashion"
        : path.startsWith("/products/")
          ? decodeURIComponent(path.split("/").pop() ?? "").replaceAll("-", " ")
          : path.startsWith("/shop")
            ? "The collection"
            : path.startsWith("/admin")
              ? "Store administration"
              : path
                  .split("/")
                  .filter(Boolean)
                  .join(" · ")
                  .replaceAll("-", " ");
    document.title = `${label[0]?.toUpperCase() + label.slice(1)} — COZZY`;
    let canonical = document.querySelector<HTMLLinkElement>(
      'link[rel="canonical"]',
    );
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href =
      window.location.origin + path + (path === "/shop" ? location.search : "");
  }, [location]);
  return null;
}
export default function App() {
  const location = useLocation();
  const admin = location.pathname.startsWith("/admin");
  return (
    <ErrorBoundary>
      <ToastProvider>
        <Metadata />
        <ScrollToTop />
        <Header />
        <main id="main" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="container page">
                <Loading />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/shop" element={<Catalog />} />
              <Route
                path="/products/:slug"
                element={<ProductPage key={location.pathname} />}
              />
              <Route path="/cart" element={<Cart />} />
              <Route path="/checkout" element={<Checkout />} />
              <Route path="/wishlist" element={<Wishlist />} />
              <Route path="/account/*" element={<Account />} />
              <Route path="/orders/:id" element={<Orders />} />
              <Route path="/admin/*" element={<Admin />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/policies/:kind" element={<Policy />} />
              <Route
                path="/newsletter/confirm"
                element={<TokenAction kind="confirm" />}
              />
              <Route
                path="/newsletter/unsubscribe"
                element={<TokenAction kind="unsubscribe" />}
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </main>
        {!admin && <Footer />}
      </ToastProvider>
    </ErrorBoundary>
  );
}

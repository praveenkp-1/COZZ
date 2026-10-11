import { useSearchParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  Search,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useProducts, useStore } from "../hooks/useStore";
import ProductCard from "../components/ProductCard";
import { Loading, ErrorMessage } from "../components/Feedback";
export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const products = useProducts(params.toString());
  const store = useStore();
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => setSearch(params.get("q") ?? ""), [params]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    setParams(next);
  }
  const title =
    params.get("gender") === "women"
      ? "For her"
      : params.get("gender") === "men"
        ? "For him"
        : params.get("featured") === "true"
          ? "New arrivals"
          : "The collection";
  return (
    <div className="container page catalog-page">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span>/</span>
        <span>Shop</span>
      </div>
      <div className="catalog-heading">
        <div>
          <p className="eyebrow">FIND YOUR EVERYDAY FAVORITES</p>
          <h1>{title}</h1>
          <p>Considered pieces. Effortless combinations. Entirely you.</p>
        </div>
        <span className="muted">{products.data?.total ?? "…"} pieces</span>
      </div>
      <div className="catalog-toolbar">
        <div className="gender-tabs" aria-label="Collection">
          <button
            className={!params.get("gender") ? "selected" : ""}
            onClick={() => update("gender", "")}
          >
            All
          </button>
          <button
            className={params.get("gender") === "women" ? "selected" : ""}
            onClick={() => update("gender", "women")}
          >
            Women
          </button>
          <button
            className={params.get("gender") === "men" ? "selected" : ""}
            onClick={() => update("gender", "men")}
          >
            Men
          </button>
        </div>
        <form
          className="catalog-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update("q", search);
          }}
        >
          <Search size={17} />
          <input
            aria-label="Search products"
            placeholder="Search the collection"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            maxLength={100}
          />
          <button className="sr-only" type="submit">
            Search
          </button>
        </form>
        <label className="sort-label">
          <span>Sort by</span>
          <select
            aria-label="Sort products"
            value={params.get("sort") ?? "newest"}
            onChange={(e) => update("sort", e.target.value)}
          >
            <option value="newest">Newest arrivals</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="popular">Bestselling</option>
          </select>
        </label>
      </div>
      <div className="catalog-body">
        <aside className="catalog-filters">
          <details open>
            <summary>
              <SlidersHorizontal size={16} />
              Refine your edit
            </summary>
            <label>
              Category
              <select
                value={params.get("category") ?? ""}
                onChange={(e) => update("category", e.target.value)}
              >
                <option value="">All categories</option>
                {store.data?.categories.map((c) => (
                  <option value={c.slug} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Size
              <select
                value={params.get("size") ?? ""}
                onChange={(e) => update("size", e.target.value)}
              >
                <option value="">All sizes</option>
                {store.data?.sizes.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Color
              <select
                value={params.get("color") ?? ""}
                onChange={(e) => update("color", e.target.value)}
              >
                <option value="">All colors</option>
                {store.data?.colors.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Minimum price (LKR)
              <input
                type="number"
                min="0"
                max="1000000"
                value={params.get("min") ? Number(params.get("min")) / 100 : ""}
                onChange={(e) =>
                  update(
                    "min",
                    e.target.value
                      ? String(Math.round(Number(e.target.value) * 100))
                      : "",
                  )
                }
                placeholder="0"
              />
            </label>
            <label>
              Maximum price (LKR)
              <input
                type="number"
                min="0"
                max="1000000"
                value={params.get("max") ? Number(params.get("max")) / 100 : ""}
                onChange={(e) =>
                  update(
                    "max",
                    e.target.value
                      ? String(Math.round(Number(e.target.value) * 100))
                      : "",
                  )
                }
                placeholder="Any price"
              />
            </label>
            {params.size > 0 && (
              <button className="text-link" onClick={() => setParams({})}>
                Clear filters
                <X size={14} />
              </button>
            )}
          </details>
        </aside>
        <div className="catalog-results">
          {products.isPending ? (
            <Loading cards />
          ) : products.error ? (
            <ErrorMessage
              error={products.error}
              retry={() => products.refetch()}
            />
          ) : products.data?.items.length ? (
            <>
              <div className="product-grid">
                {products.data.items.map((p, i) => (
                  <ProductCard product={p} index={i} key={p.id} />
                ))}
              </div>
              {products.data.pages > 1 && (
                <nav className="pagination" aria-label="Product pagination">
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={products.data.page === 1}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set("page", String(products.data.page - 1));
                      setParams(next);
                    }}
                  >
                    <ChevronLeft />
                  </button>
                  <span>
                    Page {products.data.page} of {products.data.pages}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={products.data.page >= products.data.pages}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set("page", String(products.data.page + 1));
                      setParams(next);
                    }}
                  >
                    <ChevronRight />
                  </button>
                </nav>
              )}
            </>
          ) : (
            <div className="empty-state">
              <Search size={36} />
              <h2>No pieces found</h2>
              <p>Try another search or give your filters a little more room.</p>
              <button
                className="button secondary"
                onClick={() => setParams({})}
              >
                Explore all products
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

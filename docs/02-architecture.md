# Architecture and migration plan

## Applications

An npm workspace contains `frontend/` (React, TypeScript, Vite, Tailwind, Router, TanStack Query, React Hook Form, Zod, Motion, Lucide) and `backend/` (Express, TypeScript, Prisma, PostgreSQL). Shared Zod contracts live in `shared/`. The default production deployment serves both applications from one HTTPS origin. Vite proxies `/api` locally. Express renders public home/catalog/product routes on the server so product content and metadata are present before JavaScript executes. Private routes use lazy-loaded client components and noindex metadata.

## Data model

Users with a CUSTOMER/ADMIN role, opaque sessions, one-time account tokens, addresses, hierarchical categories, products, image records, variants, inventory, server carts/items, wishlist entries, orders with immutable address/item/price snapshots, payments and webhook events, shipping methods, coupons/redemptions, reviews, collections, promotional banners, store settings, contact messages, newsletter subscriptions, audit entries, and a transactional email outbox. Monetary values are integer LKR minor units. Unique keys, foreign keys, indexes, checks, and serializable transactions protect commerce state.

## API and security

Versioned `/api/v1` REST resources: auth, products, categories, store, cart, wishlist, checkout, orders, account/addresses, reviews, newsletter/contact, and admin resources. Zod validates all writes and catalog queries. Cookie auth uses 256-bit random tokens, hashes at rest, server-side expiration/revocation, HttpOnly, SameSite=Lax and Secure in production. Login rotates the session. Mutations require an allowed Origin and a session-bound CSRF token; PayHere callbacks are exempt from CSRF and require the provider signature instead. bcrypt hashes passwords. Admin middleware reloads the user's role/status from PostgreSQL. Rate limits, security headers, upload limits/image decoding, and redacted structured logs protect entry points.

## Commerce invariants

The server recomputes prices, shipping, taxes, coupon eligibility, and stock from PostgreSQL. Checkout requires a verified account and an idempotency key bound to the request. A serializable transaction reserves stock, reserves coupon usage, creates snapshots/payment, and clears the purchased cart. PayHere checkout fields and hash are generated only on the server. Signed notifications must match merchant, order, exact amount and currency; events are deduplicated and transitions are monotonic. Failed/expired payments release reserved inventory/coupon usage once; late success is flagged for manual reconciliation instead of silently overselling. Cancellation and refunds have explicit state rules and audit history. COD uses the same transaction with a confirmed order, pending collection and no payment deadline; shipment commits its reservation and a separate audited admin action records cash receipt. Checkout recovery retains the same per-customer key across reloads. See [COD](07-cash-on-delivery.md).

## Services and deployment

PayHere hosted checkout for Sri Lanka/LKR, SMTP transactional outbox with retries, Cloudinary image upload when configured. Existing optimized media ships with the app. Local PostgreSQL can be started with an isolated development helper; production uses managed PostgreSQL. No external account is faked when unconfigured. Secrets stay server-side. Deployment uses locked dependencies, migrations, health/readiness endpoints, HTTPS reverse proxy, regular backups, and documented operational checks.

## Implementation sequence

1. Record source inventory and import provenance.
2. Establish workspace/contracts and preserve branded React layouts/hero.
3. Implement database/migrations, seeded source data, session authentication.
4. Implement catalog, cart, checkout/payment, accounts, email, and order lifecycle.
5. Implement authorized admin inventory/catalog/orders/customers/store management.
6. Run unit, PostgreSQL integration, browser purchase/navigation/accessibility tests and production builds.
7. Record actual verification and outstanding external configuration in deployment and phase-status documentation.

Production launch requires final configuration of shipping, taxation, inventory, legal policies, external service credentials, domain settings, and payment provider approval.

## Dependency maintenance

The lockfile pins the dependency graph, including Nodemailer 10, Sharp 0.35, and Vitest 5. Prisma CLI lives in root development tooling, with root overrides for `deepmerge-ts` 8 and `mysql2` 3.24 following a previously documented [workspace-link override issue](https://github.com/npm/cli/issues/9659). The application uses PostgreSQL exclusively. Retest migrations, client generation, type checks, and integration workflows after dependency changes. Run a fresh dependency audit before release; earlier zero-advisory results do not establish current security status. See [current verification limits](05-testing.md).

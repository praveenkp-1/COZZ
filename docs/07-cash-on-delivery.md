# Cash on Delivery

Customers can complete real COZZY orders with **Cash on Delivery (COD)** without PayHere credentials. COD is the default checkout option. PayHere remains available when configured; otherwise its radio option is disabled with an explanation. Production still requires published store policies, verified customer accounts, real inventory and an active delivery method.

## Order and inventory lifecycle

| Event                             | Order                | Payment            | Inventory                                                   |
| --------------------------------- | -------------------- | ------------------ | ----------------------------------------------------------- |
| COD checkout commits              | CONFIRMED            | PENDING_COLLECTION | Available stock decreases; reserved increases               |
| Admin begins fulfillment          | PROCESSING           | PENDING_COLLECTION | Reservation retained                                        |
| Admin ships with tracking         | SHIPPED              | PENDING_COLLECTION | Reserved stock commits once; available stock stays deducted |
| Admin records delivery            | DELIVERED            | PENDING_COLLECTION | No additional stock movement or payment success             |
| Admin records actual cash receipt | SHIPPED or DELIVERED | PAID               | No additional stock movement                                |
| Cancellation before shipment      | CANCELLED            | FAILED             | Reservation and coupon usage released once                  |

The existing `Payment.provider` records `COD` or `PAYHERE`. A COD payment has no provider transaction ID. `PAID` means an authorized administrator explicitly recorded receipt, with `collectedAt`, `collectedById` and a `payment.cod.collect` audit entry. It is never set by placing or delivering a COD order. Admin revenue includes cash only after collection.

Customers can cancel confirmed, uncollected COD orders. Administrators can also cancel them while processing. Shipped orders cannot release their reservation again. Collected orders use the existing refund process: perform the actual refund through the original payment method and record its reference; the application does not transfer refund money or automatically restock returns.

## Server validation and retry safety

Checkout validates the Sri Lankan address and phone/postal-code formats, the `LK` country, active delivery method, cart contents, active products/variants, available stock, stored variant/product prices, coupons, shipping fees and taxes. The current delivery model supports active methods within Sri Lanka; it has no additional postcode zones. Client-supplied prices or totals are rejected.

The existing serializable transaction and conditional stock updates prevent overselling. Cart clearing, order/payment snapshots, coupon reservation and confirmation email queuing commit together. A failed transaction leaves the cart and stock unchanged. COD reservations do not enter the PayHere expiration worker.

The existing unique `(userId, idempotencyKey)` and request hash prevent duplicate checkout. The browser retains only a random checkout key in session storage, scoped to the customer. It reuses that key after a failed request, blocks duplicate submissions, and uses the authenticated read-only `GET /api/v1/checkout/attempts/:key` endpoint to recover an order after a lost response or page reload. Different details cannot create a second order under an already used key. Storage-disabled browsers retain the key in memory for the current checkout page.

PayHere signatures, merchant/amount/currency checks, replay protection, payment identities, reservation timeout and late-payment review remain in place. PayHere callbacks and hosted-payment requests explicitly reject COD orders.

## Collecting cash

1. In **Admin → Orders**, select the COD order under **Update an order**.
2. Move it through **processing** and **shipped**, providing tracking. Record **delivered** when appropriate.
3. After actual receipt, tick the confirmation for the full LKR amount in **Cash on Delivery** and select **Mark cash as collected**.
4. The receipt displays its collection time and responsible administrator. Repeat or concurrent collection attempts cannot record another payment or audit event.

The collection endpoint is `POST /api/v1/admin/orders/:id/collect` with an empty JSON body. It requires an active administrator session, valid Origin and CSRF token, a shipped/delivered COD order and `PENDING_COLLECTION`. The server derives the amount from the order and records the timestamp itself.

## Migration and development

`backend/prisma/migrations/202610110001_cash_on_delivery/migration.sql` adds `PENDING_COLLECTION`, nullable collection fields with an administrator foreign key, receipt consistency checks and an index. `Order.expiresAt` becomes nullable so COD has no online-payment deadline. Existing records, expiration values and earlier migrations are retained.

For another environment, run `npm run db:generate` and `npm run db:migrate`, then build/deploy the updated application. The migration command is `prisma migrate deploy`. Never reset an existing database to enable COD. No PayHere credentials or `.env` changes are required.

## Verification and isolation

The integration suite includes COD with blank PayHere credentials, real PostgreSQL order creation, insufficient stock, concurrent duplicate requests, customer checkout races, admin inventory races, invalid delivery details, product availability, authoritative totals/coupons, reservation expiry isolation, cancellation/shipping races, cash collection and unauthorized collection. Existing PayHere regression cases include signature/amount verification, replay protection, refunds, expiration and rejection of signed callbacks targeting COD.

The browser suite includes a real COD order, a deliberately lost checkout response, reload recovery, customer history and admin collection. The existing PayHere browser journey explicitly selects online payment.

Tests create fresh `cozzy_test_<random>` databases and refuse production fixtures. To retain those test databases without deleting any database, use PowerShell:

```powershell
$env:KEEP_TEST_DATABASE = 'true'
npm.cmd run test:integration
$env:PLAYWRIGHT_CHANNEL = 'chrome' # Optional: use installed Chrome locally.
npm.cmd run test:e2e -- --output=test-results/cod-browser
$env:TEST_PAYHERE_UNCONFIGURED = 'true'
npm.cmd run test:e2e -- --grep COD --output=test-results/cod-browser-unconfigured
```

Clear these temporary shell variables afterward. Without `KEEP_TEST_DATABASE=true`, the existing test runner removes only the disposable database it created. When CI is added or restored, install Chromium and use the same isolated test runners; this snapshot contains no GitHub Actions workflow.

## Recorded local verification (11 October 2026)

The earlier COD implementation report records verification on Windows with Node.js 24.15.0 and npm 11.12.1. These are historical local results, not results from the subsequent readiness audit or remote CI:

- `npm run typecheck`: passed for both workspaces.
- `npm test`: 36 unit tests passed across seven files.
- `npm run test:integration`: 34 PostgreSQL test results passed (32 cases and two parent suites), including COD without gateway credentials and the PayHere regressions.
- `npm run build`: passed, including assets, Prisma generation, frontend browser/SSR bundles and Express backend compilation.
- Complete browser suite: all five journeys passed using installed Chrome, including the existing PayHere boundary journey and COD checkout, lost-response recovery, order history, fulfillment and audited cash collection.
- Separate COD browser run with empty PayHere merchant credentials: passed; online payment was visibly disabled while COD completed normally.
- The additive COD migration applied successfully to the existing local database and fresh isolated test databases. Original local user/order/payment/inventory row counts matched the pre-change baseline, and the `.env` SHA-256 checksum was unchanged. No database was deleted or reset; test databases were retained.

These checks did not exercise a live PayHere account or settlement. Linux execution was not performed for this change.

## Changed files

| Area                                 | Files                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Request contract                     | `shared/contracts.ts`                                                                                       |
| Database                             | `backend/prisma/schema.prisma`; new `backend/prisma/migrations/202610110001_cash_on_delivery/migration.sql` |
| Transactional order/payment services | `backend/src/services/orders.ts`, `backend/src/services/payhere.ts`                                         |
| Customer and admin API               | `backend/src/routes/customer.ts`, `backend/src/routes/admin.ts`                                             |
| Storefront pages                     | `frontend/src/pages/Checkout.tsx`, `Orders.tsx`, `Account.tsx`, `Admin.tsx`                                 |
| Storefront types/helpers             | `frontend/src/types/index.ts`; new `frontend/src/services/checkout.ts`, `orders.ts`                         |
| Unit tests                           | `tests/unit/contracts.test.ts`; new `tests/unit/checkout.test.ts`                                           |
| Integration tests                    | `tests/integration/commerce.test.ts`; new `tests/integration/cod.test.ts`                                   |
| Browser tests/fixtures               | `tests/e2e/store.spec.ts`, `tests/e2e/seed.ts`                                                              |
| Test tooling                         | `scripts/test-database.mjs`, `scripts/integration-test.mjs`, `scripts/e2e-test.mjs`, `playwright.config.ts` |
| Documentation                        | `README.md`, `docs/02-architecture.md`, `docs/03-deployment.md`, this document                              |

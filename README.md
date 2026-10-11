# COZZY — Full-Stack Clothing E-Commerce Platform

![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)

COZZY is a clothing e-commerce application for Sri Lanka, with prices in LKR, customer accounts, transactional checkout, and store administration. It evolved from an HTML, CSS, and JavaScript storefront into a React and Express application backed by PostgreSQL, preserving the original branding and product photography.

The project demonstrates shared TypeScript validation, server-rendered public pages, persistent carts, stock reservations, payment verification, and administrator workflows. **Public deployment is pending; Vercel + Neon is the intended hosting plan and still needs integration work.**

## Project preview

No application screenshots are available in this repository snapshot. Capture the following views using a disposable demonstration database and fictional customer details before publishing the portfolio:

| View                       | What to capture                                              |
| -------------------------- | ------------------------------------------------------------ |
| Homepage                   | Desktop editorial hero and mobile navigation                 |
| Product catalog            | Product grid, search, filters, and sorting                   |
| Product details            | Image gallery, size/color selection, and stock state         |
| Shopping cart and checkout | Cart summary, delivery quote, COD and PayHere options        |
| Customer account           | Profile, saved addresses, and order history                  |
| Admin dashboard            | Revenue/order overview, low stock, and management navigation |

Browser tests can write captures to ignored `test-results/screenshots/`. Review captures for personal data and copy selected images to a maintained documentation asset folder before adding Markdown image links.

## Key features

### Customer experience

- Responsive storefront with search, category/collection/price/size/color filters, sorting, and pagination.
- Product galleries, size/color variants, stock availability, and persistent account wishlists.
- Persistent guest and customer carts, including cart merging at sign-in.
- Registration, email verification, password recovery, profile/password settings, and saved addresses.
- Checkout with server-calculated prices, coupons, delivery fees, taxes, and retry recovery using an idempotency key.
- **Cash on delivery:** confirmed orders with payment pending until an administrator records actual cash receipt after shipment.
- Order history, fulfillment status, tracking references, and eligible order cancellation.
- Moderated reviews from customers whose paid purchases have been delivered; contact and confirmed newsletter subscription flows.

### Store administration

- Dashboard with revenue from paid orders, customer/order counts, and low-stock variants.
- Product creation/editing/archiving, images, variants, and inventory.
- Order fulfillment, shipment tracking, audited COD collection, and records of refunds completed externally.
- Customer lookup, order history, and account disabling.
- Coupons, shipping methods, categories, collections, promotional banners, store settings, and policy publishing.
- Review/contact moderation and audit records.

### External integrations

| Integration | Implemented behavior                                                                                                   | Configuration still required                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PayHere     | Hosted checkout, server-generated hashes, signed callbacks, replay checks, reservation expiry, and late-payment review | Merchant approval, sandbox credentials, public HTTPS callback, and real provider verification; online payment is disabled without credentials |
| SMTP        | Transactional email outbox with retries and database leases                                                            | Verified sender, SMTP credentials, and delivery checks; development can write messages to ignored `.local/mail/`                              |
| Cloudinary  | Administrator image uploads with type, size, and decoded-image validation                                              | Account credentials and a successful upload test; catalog images are built locally                                                            |

COD works without PayHere credentials. Production checkout still requires verified accounts, available stock, an active delivery method, and published store policies. Refund transfers take place outside the application.

## Technology stack

| Area                        | Technologies                                                    | Role                                                                                                                     |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Frontend                    | React 19, TypeScript, Vite 7, Tailwind CSS 4                    | Storefront, account, and admin interfaces; browser and SSR builds                                                        |
| Client data and forms       | React Router, TanStack Query, React Hook Form, Zod              | Routing, server-state caching, forms, and validation                                                                     |
| UI and media                | Motion, Lucide, local Fontsource fonts, Sharp                   | Animation, icons, typography, and responsive WebP assets                                                                 |
| Backend                     | Node.js, Express 5, TypeScript                                  | REST API, public-page rendering, and background processing                                                               |
| Database                    | PostgreSQL, Prisma 7, `@prisma/adapter-pg`, `pg`                | Models, SQL migrations, connection pooling, and transactions                                                             |
| Authentication and security | Opaque cookie sessions, bcrypt, Zod, Helmet, express-rate-limit | Password hashing, server-side sessions, CSRF/Origin checks, validation, and request limits                               |
| Payments and services       | COD, PayHere, Nodemailer/SMTP, Cloudinary                       | Cash collection, hosted online payment, email, and uploads                                                               |
| Testing                     | Vitest, Node.js test runner, Supertest, Playwright              | Unit checks, PostgreSQL/API workflows, and Chromium journeys                                                             |
| Deployment                  | Docker/Caddy templates; Vercel + Neon planned                   | Existing long-running Node topology and intended managed hosting; no GitHub Actions workflow is present in this snapshot |

## System architecture

```mermaid
flowchart LR
  Browser[React storefront] --> API[Express API and public SSR]
  API --> Prisma[Prisma ORM]
  Prisma --> DB[(PostgreSQL)]
  Browser --> PayHere[PayHere hosted checkout]
  PayHere -->|Signed callback| API
  API --> SMTP[SMTP email outbox worker]
  API --> Cloudinary[Cloudinary uploads]
```

React calls `/api/v1` through the Vite proxy during development. The production Node server serves the built frontend and renders public home, catalog, product, contact, and policy routes; account/admin views load on the client. Shared Zod contracts validate input on both sides.

Checkout runs in serializable database transactions, snapshots order details, and reserves stock. COD records collection separately from delivery. PayHere return pages read persisted state; only a verified provider notification can confirm online payment. See [architecture](docs/02-architecture.md) for the data model and security decisions.

## Getting started

### Prerequisites

- Node.js 24 and npm; the root package declares Node.js `>=22.18.0`, and historical local verification used Node.js 24.15.0/npm 11.12.1.
- PostgreSQL, using the optional bundled PostgreSQL 18 helper, an existing local installation, or Docker.
- Git for cloning the published repository.

### 1. Clone and install

Replace `<your-repository-url>` with the actual published repository URL; this snapshot contains no Git remote.

```sh
git clone <your-repository-url> cozzy
cd cozzy
npm ci --include=dev --include=optional
```

In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

### 2. Configure a local database

For a new local setup:

```sh
npm run db:local
```

Keep this terminal open. The helper creates `.env` with a random local database password when absent, binds PostgreSQL to loopback, and persists data in ignored `.local/postgres/`. It preserves existing configuration and refuses to reinitialize nonempty unrecognized data. Stop it with **Ctrl+C**.

Alternatively, copy [.env.example](.env.example) to `.env` **only when `.env` does not already exist**, then configure `DATABASE_URL` for your own PostgreSQL database. For Docker, set `POSTGRES_PASSWORD` and a matching `DATABASE_URL`, then run `docker compose up -d postgres`. Use one database option at a time.

### 3. Initialize a fresh development database and start

In another terminal:

```sh
npm run assets
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

`db:migrate` runs `prisma migrate deploy`; `db:seed` writes the initial catalog. These are setup instructions for a fresh development database, not commands to run during a read-only audit. Never reset, drop, or reseed an existing development or production database to follow this guide.

Open **http://localhost:5173**; Express runs on port **4000**. The maintained catalog contains **34 products**. Inventory starts at zero: enter stock through administration, or set `DEMO_INVENTORY=true` before the first seed of a disposable development database. Production must use real inventory. See [catalog maintenance](docs/01-catalog-and-assets.md).

### 4. Create accounts

Register through the storefront. Without SMTP in development, the email worker writes verification/reset messages to `.local/mail/` within its 15-second polling cycle. Open the complete verification link, including `#token=`, and confirm it before checkout.

For the first administrator, supply `ADMIN_EMAIL` and a unique `ADMIN_PASSWORD` of at least 12 characters through your private local environment, then run:

```sh
npm run admin:create
```

Sign in and visit `/admin`. The bootstrap command refuses to promote an existing account. Remove the bootstrap password afterward; no default administrator is provided.

## Environment configuration

Use [.env.example](.env.example) for local development and [.env.production.example](.env.production.example) for deployment variable names. The following values are placeholders:

```dotenv
NODE_ENV=development
PORT=4000
APP_ORIGIN=http://localhost:5173
PUBLIC_API_ORIGIN=http://localhost:5173
DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:55432/cozzy
DEMO_INVENTORY=false
PAYHERE_MODE=sandbox
PAYHERE_MERCHANT_ID=
PAYHERE_MERCHANT_SECRET=
SMTP_HOST=
SMTP_USER=
SMTP_PASSWORD=
MAIL_FROM=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Production requires public HTTPS origins plus `SMTP_HOST` and `MAIL_FROM`; provider authentication and TLS settings must match the actual service. Configure `TRUST_PROXY` for the real proxy topology. All database and service secrets belong in server-side environment settings, never `VITE_*` variables or committed environment files.

## Testing

| Layer            | Command                    | Coverage and requirements                                                                                                                        |
| ---------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types            | `npm run typecheck`        | Frontend and backend TypeScript projects                                                                                                         |
| Unit             | `npm test`                 | Pricing, contracts, checkout recovery, catalog/assets, native dependency records, database-helper guards, and mocked seeding; no database access |
| Production build | `npm run build`            | Media generation, Prisma generation, browser bundle, SSR renderer, and compiled API; no migrations or seeding                                    |
| Integration      | `npm run test:integration` | Node.js/Supertest workflows against a newly created local PostgreSQL test database                                                               |
| Browser          | `npm run test:e2e`         | Five Playwright journeys, including COD and an intercepted PayHere boundary; requires a build, Chromium, and a local test database server        |

Install the browser once with `npx playwright install chromium`. Database suites require `CREATEDB` privileges and create random `cozzy_test_<hex>` databases; the runners reject production mode and nonlocal database hosts. By default they remove only the database they created. Set `KEEP_TEST_DATABASE=true` to retain test databases.

**Readiness audit, 11 October 2026:** both TypeScript checks, the complete production build, and all 36 unit tests passed locally. The npm dependency audit reported zero known advisories at that time. PostgreSQL and browser suites were not rerun; no database commands were executed.

**Recorded COD results:** the earlier [11 October 2026 COD verification](docs/07-cash-on-delivery.md) reports 34 PostgreSQL results (32 cases plus two parent suites), five browser journeys, and a separate COD run without PayHere credentials. These remain historical local results, not current CI results or real-provider evidence. See [testing](docs/05-testing.md) for limits. No GitHub Actions workflow is included in this snapshot.

## Deployment

**Vercel + Neon is planned, not verified.** The current build produces `frontend/dist/`, its SSR renderer at `frontend/dist/server/entry-server.js`, and the API under `backend/dist/`. `npm start` runs the long-lived Express service.

The final pre-publication check fixed the Node/container hero image routing: Express now serves `/images` from `frontend/dist/images` before its SSR catch-all. All four homepage images passed compiled-server checks for successful responses, WebP content types, and exact file contents; missing/private paths still return 404. Vercel static output still requires separate configuration and verification.

Vercel supports Express applications, but this workspace still needs a verified project root/entry point, build packaging, static asset delivery, SSR routing, and runtime file paths. Its existing `express.static()` asset handling cannot be assumed to work on Vercel. See [Vercel's Express documentation](https://vercel.com/docs/frameworks/backend/express).

Before deploying the complete application:

- Move the 15-second email worker and minute-based reservation cleanup from in-process timers to durable scheduled processing.
- Validate Neon TLS and pooling. Runtime currently allows ten `pg` connections per process; Prisma CLI also reads `DATABASE_URL`, so supply the direct URL to the migration job separately.
- Reconcile the 8 MiB admin image upload allowance with the chosen function limits; verify Cloudinary uploads.
- Verify same-origin HTTPS routing, cookies, CSRF, `/health/live`, `/health/ready`, SMTP delivery, and the public PayHere callback.
- Run staging migrations and isolated tests, configure real stock/shipping/taxes/policies, and rehearse backups and recovery.

Docker app/tools images, production Compose, and Caddy HTTPS templates are available as an alternative for a compatible long-running Node host. Container builds and public hosting remain unverified. See [deployment instructions](docs/03-deployment.md) for the full plan and release checks.

## Project documentation

| Guide                                               | Contents                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| [Catalog and assets](docs/01-catalog-and-assets.md) | Maintained products, source media, provenance, and seeding                    |
| [Architecture](docs/02-architecture.md)             | Applications, data model, API security, and commerce rules                    |
| [Deployment](docs/03-deployment.md)                 | Vercel/Neon gaps, Docker alternative, operations, and release checks          |
| [PayHere](docs/04-payhere.md)                       | Merchant configuration, callbacks, and sandbox checklist                      |
| [Testing](docs/05-testing.md)                       | Commands, database isolation, coverage, and verification limits               |
| [Project status](docs/06-phase-status.md)           | Implementation progress, readiness audit, and launch requirements             |
| [Cash on delivery](docs/07-cash-on-delivery.md)     | Inventory lifecycle, audited cash collection, migration, and COD verification |

```text
frontend/src/      Storefront, customer/admin pages, styles, and API clients
backend/src/       Express routes, authentication, commerce, and email services
backend/prisma/    Schema, SQL migrations, and initial catalog seed
shared/            Shared Zod request contracts
data/              Product catalog and provenance
source/            Original photography, branding, and supplier references
scripts/           Asset generation, local PostgreSQL, and test runners
tests/             Unit, integration, and browser suites
deploy/            Production Compose and Caddy templates
docs/              Technical guides and implementation status
```

## Project status

| Area              | Status                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application       | Customer, commerce, and admin workflows are implemented with automated test suites; historical local results are documented                             |
| External services | PayHere, SMTP, and Cloudinary code exists; real credentials and end-to-end provider checks remain                                                       |
| Public deployment | No successful live deployment has been verified; Vercel/Neon adaptation and staging validation remain                                                   |
| GitHub release    | README and documentation reviewed; restore/initialize Git metadata, verify tracked files and history, add CI, and capture portfolio screenshots         |
| Business launch   | Verify source-content permissions, catalog price discrepancies, stock, delivery/tax rules, approved policies, support details, and garment measurements |

The [readiness audit and release checklist](docs/06-phase-status.md) record evidence and remaining work. A repository scan cannot establish Git-history safety when `.git` is unavailable.

## Author

**KP** — creator of COZZY, as credited in the application footer. Built as a full-stack portfolio project demonstrating frontend development, API design, relational data modeling, authentication, transactional commerce, testing, and deployment planning.

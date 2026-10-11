# Deployment

## Overview and deployment status

COZZY is a full-stack e-commerce application built with React, TypeScript, Vite, Express, Prisma, and PostgreSQL. The preferred planned hosting stack is **Vercel** for the web application and compatible HTTP API functions, **Neon** for managed PostgreSQL, and **Cloudinary** for uploaded images when configured.

**Status:** This document is a deployment guide, not evidence that a production deployment has been completed. Validate the application against the selected hosting platform before claiming it is live. The Docker/Caddy configuration below is an alternative self-hosted topology, not the Vercel configuration.

## Architecture and hosting compatibility

The application is designed around one HTTPS origin for the storefront and `/api/v1` endpoints. A single origin simplifies cookies, CSRF protection, and payment callback routing. Locally, Vite proxies `/api` to Express. The existing Express server also renders public home, catalog, and product pages on the server for HTML content and metadata before JavaScript loads.

**Vercel compatibility requires verification and potentially code changes.** [Vercel supports Express directly](https://vercel.com/docs/frameworks/backend/express), including recognized entry files that export an application or call `app.listen()`. The existing listener alone is therefore not proof of incompatibility. This workspace has no verified Vercel build/routing configuration: `backend/src/app.ts` exports an app factory, while `backend/src/server.ts` adds SSR/static routes, starts the listener, and schedules workers. Before using Vercel, confirm or implement:

- A recognized entry point and project root that load the full Express server, shared contracts, and generated Prisma code. Verify discovery in this npm workspace; a custom adapter is not automatically required.
- Packaging for `frontend/dist/index.html` and the dynamically imported `frontend/dist/server/entry-server.js`. The server derives paths from its working directory, which must be verified in the deployed function.
- Routing so `/api/v1/*`, public SSR routes, and static Vite assets work under the same HTTPS domain. Vercel's Express integration ignores `express.static()`; publish the generated assets/media and retained `frontend/public/images/` through the supported static output and test every URL.
- Correct cookie, trusted-proxy, origin, and CSRF behavior through Vercel's proxy layer.
- A strategy for scheduled tasks and email processing. In-process intervals and always-on background workers cannot be relied on in request-driven functions; use scheduled jobs, a durable queue/worker, or an appropriate separately hosted service.
- Appropriate database connection management for serverless concurrency (Neon's pooled connection endpoint or another Prisma-compatible strategy, where appropriate).
- Build output and Prisma client generation compatible with the deployment runtime.
- Admin uploads compatible with [function payload limits](https://vercel.com/docs/functions/limitations): the application accepts images up to 8 MiB, while the documented function body limit is 4.5 MB including multipart overhead. Lower the application limit or implement authenticated direct uploads before promising equivalent behavior.

If these changes are not implemented, deploy the existing long-running Express service on a suitable Node/container host instead, while still using Neon for PostgreSQL. Do not claim that a static React deployment alone includes a working API, SSR, checkout, or background jobs.

**Node/container image routing corrected:** the homepage's four `/images/hero/*.webp` files are retained in `frontend/public/images/hero/` and copied by Vite into `frontend/dist/images/hero/`. The final pre-publication check added a directory-scoped `/images` mount before the SSR catch-all in `backend/src/server.ts`, using the same one-day cache policy as `/media`. Compiled-server checks verified all four files, HEAD/conditional requests, and 404 responses for missing/private paths with database access and workers disabled. Vercel static output still needs separate configuration and staging verification.

## Node.js and build requirements

Use a supported Node.js version compatible with the project dependencies. Historical local checks used Node.js 24.15.0 and npm 11.12.1, also installed on the readiness-audit machine. No CI workflow is present in this snapshot; verify the selected host's runtime and add or restore CI before relying on remote checks. The root `package-lock.json` is the dependency source of truth.

For a compatible Node/container build, from the repository root:

```sh
npm ci --include=dev --include=optional
npm run build
```

The existing long-running server starts with:

```sh
npm start
```

This start command is for the traditional Node/container deployment. It is **not**, by itself, a Vercel serverless deployment configuration. The build generates optimized media from retained source assets, generates the Prisma client, and compiles TypeScript. Never deploy the Vite development server or the embedded local PostgreSQL helper as the production service.

## Environment variables and secrets

Use `.env.production.example` as a reference for required variable names. Configure real values in the hosting platform's protected environment-variable settings or a restricted deployment secret store. Never commit `.env`, `.env.production`, connection strings, credentials, or private keys to GitHub.

Required settings depend on enabled features and may include:

| Variable                 | Purpose                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `APP_ORIGIN`             | Exact public HTTPS store origin, without a trailing slash                                  |
| `PUBLIC_API_ORIGIN`      | Public origin used for API/payment callbacks; for same-origin hosting, use the same origin |
| `DATABASE_URL`           | Neon PostgreSQL connection string with verified TLS                                        |
| `MAIL_FROM`              | Verified sender address for transactional mail                                             |
| SMTP configuration       | Credentials and server settings for transactional email                                    |
| Cloudinary configuration | Server-side credentials for image uploads                                                  |
| PayHere configuration    | Server-side merchant/payment integration credentials                                       |
| `DEMO_INVENTORY`         | Must be `false` for real production inventory                                              |

Do not expose database, SMTP, Cloudinary, or PayHere secrets through client-side Vite environment variables or frontend bundles. Use the actual variable names defined in `.env.production.example`; this table is conceptual and does not replace that file.

Set `APP_ORIGIN` and `PUBLIC_API_ORIGIN` to the exact HTTPS storefront origin. The production application is designed to reject non-HTTPS origins and missing required email configuration. If PayHere credentials are absent, online payment should remain unavailable; cash on delivery can operate without gateway credentials if all required policies and checkout configuration are complete.

Never disable PostgreSQL TLS certificate verification to work around a connection problem.

## Neon PostgreSQL setup

1. Create a Neon project and production database.
2. Configure the correct production `DATABASE_URL` as a protected server-side environment variable.
3. Select a Prisma-compatible pooled runtime connection and direct migration connection. The current `PrismaPg` adapter uses `pg` with `max: 10`, a five-second connection timeout, and a 30-second idle timeout. Neither `@prisma/adapter-neon` nor an environment-configurable pool size is implemented. Validate Neon behavior under serverless concurrency before changing the adapter or pool settings.
4. Use separate database identities where practical: a migration identity with schema privileges and a runtime identity limited to application operations.
5. Confirm TLS verification, connection limits, and database region/latency.
6. Enable the backup and recovery capabilities available on the chosen Neon plan and verify restoration procedures.

### Database migrations

Run once per release, before switching application traffic:

```sh
npm run db:migrate
```

This executes `prisma migrate deploy`. Both `backend/prisma.config.ts` and the runtime adapter currently read `DATABASE_URL`; there is no implemented `DIRECT_URL` setting. Supply Neon's direct connection as `DATABASE_URL` in the controlled migration job and its pooled connection as `DATABASE_URL` in runtime settings. [Prisma's PostgreSQL guidance](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql) explains separate CLI/runtime connection strategies. **Do not run production schema migrations automatically from every Vercel function invocation.** Never run `db push`, `migrate reset`, or development migration commands against production.

Back up the database before schema changes and rehearse migrations against staging data.

### Initial catalog seed

On the first deployment, after migrations:

```sh
npm run db:seed
```

The seed imports the maintained product catalog with zero inventory unless explicitly configured otherwise for a non-production environment. It preserves existing live products and inventory on subsequent runs. Seeding is not a replacement for ongoing inventory management; live catalog updates should use the administrative application.

### Initial administrator

Run the administrative bootstrap only in a secure one-time job:

```sh
npm run admin:create
```

Provide `ADMIN_EMAIL` and `ADMIN_PASSWORD` securely through that job's environment. Remove the bootstrap password from the job configuration after successful creation. Do not put the administrator password in GitHub, deployment documentation, screenshots, or command history.

Before accepting customers, configure real inventory, shipping and tax rules, support email, returns/shipping/privacy/terms policies, image descriptions, and homepage merchandising.

## Vercel deployment plan

The following is the intended procedure **after** the serverless compatibility requirements above have been implemented and tested.

1. Push the source code, lockfile, and safe configuration templates to GitHub. Exclude `node_modules/`, generated test output, build output, and all real `.env` files.
2. Import the GitHub repository into Vercel.
3. Configure the repository root, build command, output settings, and function routing according to the verified Express integration. Do not assume that a Vite-only preset deploys the Express API or server-rendered routes.
4. Add protected environment variables for the applicable environment (Preview or Production).
5. Connect the application to Neon using server-side credentials only.
6. Run migrations and the initial seed from a controlled release job, not during ordinary page requests.
7. Deploy and verify static assets, SSR HTML, API endpoints, login cookies, CSRF checks, database access, checkout, and webhook callbacks.
8. Configure durable background-job processing and scheduled reservation cleanup before enabling real commerce.
9. Add the production domain and update `APP_ORIGIN`, `PUBLIC_API_ORIGIN`, payment callback settings, canonical URLs, and any provider allowlists.

**Deployment is not complete until these checks pass.** If the backend's current server and worker architecture is not compatible with Vercel, keep the frontend on Vercel only if the API/SSR design is explicitly adjusted; otherwise use a compatible long-running host for the complete application.

## Alternative: Docker and Caddy self-hosting

The repository includes container deployment templates for a traditional, long-running Node service. These templates require your own server, DNS, managed database, secrets, and domain. They are separate from Vercel deployment.

Build the application and administrative tools images:

```sh
docker build --target app -t cozzy:release .
docker build --target tools -t cozzy-tools:release .
```

Run controlled migrations and first-time seeding:

```sh
docker run --rm --env-file .env.production cozzy-tools:release npm run db:migrate
docker run --rm --env-file .env.production cozzy-tools:release npm run db:seed
```

The tools image contains administrative source and development tools; restrict access to it. The app image runs compiled code as the unprivileged `node` user. Push the application image to a private registry and configure `COZZY_IMAGE` and a restricted `.env.production` on the host.

For the supplied reverse proxy template, configure `COZZY_DOMAIN`, point DNS A/AAAA records to the host, allow ports 80 and 443, then run:

```sh
docker compose -f deploy/compose.production.yaml up -d
```

Caddy obtains and renews HTTPS certificates. Keep the Node port internal. With exactly one trusted reverse proxy, the template uses `TRUST_PROXY=1`; adjust proxy trust to the real deployment topology and restrict direct access. Incorrect proxy trust can weaken IP-based rate limits. Persistent Caddy certificate volumes and an externally managed PostgreSQL database are part of this topology.

## Payment configuration and launch readiness

Use PayHere hosted checkout for Sri Lanka/LKR. Payment fields and hashes must be generated on the server. Signed notifications must be verified against merchant identity, order, exact amount, and currency, and deduplicated. Keep `PAYHERE_MODE=sandbox` until the merchant checklist in [PayHere integration](04-payhere.md) is complete and the provider approves live operation.

Test sandbox success, cancellation, failure, and duplicate notification cases. Do not accept real customer payments during staging tests. Confirm that payment status transitions, reserved inventory, coupons, late payment handling, cancellation, and refunds follow the application's documented transaction rules.

Cash on delivery uses its own confirmed-order and pending-collection lifecycle. Review the [cash-on-delivery documentation](07-cash-on-delivery.md) before enabling it.

## Release validation

Run unit, PostgreSQL integration, and browser tests in CI using disposable test infrastructure. Restore a recent production backup into staging when rehearsing migrations. Verify:

- Public product HTML includes useful content and JSON-LD without JavaScript.
- Canonical URLs reference the production domain and the sitemap serves XML.
- Authenticated/private pages carry `noindex` metadata.
- Login, account recovery, and transactional email work with the configured SMTP provider.
- Cloudinary uploads work if enabled.
- Payment sandbox callbacks are validated, deduplicated, and reconciled correctly.
- The `__Host-cozzy` cookie is Secure, HttpOnly, and SameSite=Lax.
- Unsafe authenticated mutations enforce allowed Origin and valid CSRF tokens.
- Product stock, checkout, order management, mobile navigation, and keyboard interaction work against the actual deployed origin.

Run a mobile Lighthouse audit on staging and record measured results rather than claiming an unmeasured score.

## Backups and monitoring

Enable automated PostgreSQL backups and point-in-time recovery where available. A possible starting objective is 30 days of recoverable history and a monthly restore rehearsal, subject to provider capabilities and business requirements. Keep encrypted backup access separate from runtime credentials. Verify restores retain orders, payment events, inventory reservations, user records, and audit history.

Cloudinary images require their own retention/export strategy; database backups do not include hosted image bytes.

The application exposes:

- `GET /health/live` — process liveness.
- `GET /health/ready` — PostgreSQL readiness.

These checks suit a long-running service. For Vercel, adapt readiness and monitoring to the function execution model rather than assuming a continuously running process.

Configure external HTTPS monitoring and alerts for readiness failures, sustained 5xx responses, reservation cleanup failures, payment-review orders, and email jobs with eight failed attempts. Use structured logs without sensitive query strings, passwords, cookies, authorization headers, provider secrets, message bodies, or account tokens. Restrict log retention and access.

### Background jobs

The existing long-running architecture retries email delivery with backoff and a database lease. SMTP is at-least-once: a crash after provider acceptance can cause a retry with the same Message-ID. The server currently schedules expired unpaid reservation cleanup every minute and email delivery every 15 seconds.

**These in-process intervals are not reliable in Vercel functions.** Replace them with a durable worker/scheduler architecture before relying on them in production. Scheduled HTTP invocations, where used, must be authenticated, idempotent, and designed for platform execution limits. The exact job cadence may need to change based on hosting-plan capabilities.

No scheduler endpoints or Vercel cron configuration are implemented here. [Vercel's documented Hobby cron restrictions](https://vercel.com/docs/cron-jobs/manage-cron-jobs) allow only daily execution, which cannot preserve the current 15-second/minute cadence. Select a suitable worker/scheduler before enabling checkout and email-dependent account verification.

Failed email jobs require operator review. After investigating the transport, reset attempts and `nextAttemptAt` through an audited administrative action. Never log email contents or account tokens.

## Scaling and database connections

The initial traditional Node deployment targets one application replica and uses in-process rate limiting. Before adding replicas, use a shared rate-limit store or equivalent gateway enforcement. Database transactions and email leases support concurrency but do not replace gateway limits or capacity planning.

Serverless deployments can create bursts of concurrent database connections. Configure Prisma/Neon pooling and concurrency carefully, test realistic traffic, and use an external/shared rate-limiting solution rather than relying on per-instance in-memory limits.

## Rollback

Retain the previous immutable application build or image. Roll back application traffic only if the previous code remains compatible with the migrated schema. Prisma does not automatically reverse production migrations. For incompatible changes, use a reviewed forward fix or a rehearsed restore plan that accounts for orders and payments received since the backup. Reconcile payment-provider settlements before altering payment records.

## Native build dependencies and CI

No `.github/workflows/ci.yml` or other workflow is present in this snapshot. Restore or create CI before publishing a status badge or claiming remote validation. Use the recorded Windows toolchain (Node.js 24.15.0/npm 11.12.1) as a reproducibility reference, then validate Linux independently. Install dependencies from the repository root to respect the shared lockfile and npm workspaces. Include development and optional dependencies for builds; production containers omit development dependencies while retaining necessary runtime optional bindings such as Sharp.

Tailwind Oxide 4.3.3 needs a native binding for the current platform. An earlier lockfile included only `@tailwindcss/oxide-win32-x64-msvc`, causing clean Ubuntu builds to fail because `@tailwindcss/oxide-linux-x64-gnu` was missing. This matches the documented [npm optional-dependency lockfile issue](https://github.com/npm/cli/issues/4828). The original command that produced the incomplete lockfile is unknown. The repair added missing npm-generated platform records and WASI dependencies at the existing locked versions without upgrading unrelated packages.

Do not omit optional dependencies or copy Windows `node_modules` into Linux builds. Keep the generated cross-platform lockfile entries; npm installs only those compatible with the host. Native-dependency tests check bindings for Linux glibc, Linux musl, and Windows x64. A restored CI workflow should import Oxide and Lightning CSS after `npm ci` to detect missing bindings before building, generate assets, and run type checks, unit tests, production builds, and isolated database/browser suites. Cache npm downloads rather than `node_modules`.

If a later dependency update loses platform entries, resolve the affected package at its exact locked version in an empty temporary directory and compare generated lockfile records before merging. Avoid deleting the project lockfile or upgrading unrelated dependencies merely to repair a missing native binding.

## Public repository safety checklist

Before publishing:

- Keep `.env`, `.env.production`, database URLs, API secrets, merchant secrets, SMTP passwords, and administrator bootstrap passwords out of Git.
- Commit `.env.example` and `.env.production.example` only with placeholders.
- Exclude `node_modules/`, `test-results/`, `playwright-report/`, generated builds, and logs.
- Check Git history for previously committed secrets; removing a secret from the latest commit is not enough. Rotate any exposed credentials.
- Ensure documentation accurately distinguishes implemented, tested, and planned deployment features.

This document contains example commands and variable names, not real credentials. It does not certify the security or operational readiness of a deployed application.

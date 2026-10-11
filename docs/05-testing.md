# Testing

## Commands and isolation

| Command                    | What it verifies                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`        | Frontend and backend TypeScript projects                                                                                                                       |
| `npm test`                 | Vitest unit tests, including pricing, contracts, checkout recovery, catalog/assets, native dependency records, mocked seed behavior, and local database guards |
| `npm run build`            | Optimized media, generated Prisma client, browser bundle, SSR renderer, and compiled Express API                                                               |
| `npm run test:integration` | Node.js/Supertest workflows against a fresh local PostgreSQL database                                                                                          |
| `npm run test:e2e`         | Playwright Chromium journeys against the compiled server and a separate fresh local PostgreSQL database                                                        |

Unit tests do not connect to PostgreSQL. Seed tests replace database calls with in-memory mocks, and local database helper tests use temporary filesystem fixtures. Build and type-check scripts contain no migration, seed, reset, or application startup step. In a clean checkout, run `npm run assets` before unit tests because catalog tests check generated media.

Integration/browser runners in `scripts/test-database.mjs` reject `NODE_ENV=production` and database hosts outside `127.0.0.1`, `localhost`, and `postgres`. They create a random `cozzy_test_<16 hex>` database, apply migrations, and seed only that database. Fixture files independently require test mode and an isolated database name. These checks do not make an arbitrary PostgreSQL server safe: use a dedicated local test server with a `CREATEDB` identity.

Without an override, cleanup drops only the generated database. For checks that must not delete any database, set:

```powershell
$env:KEEP_TEST_DATABASE = 'true'
npm.cmd run test:integration
npm.cmd run test:e2e
```

Remove that temporary shell variable afterward. `TEST_DATABASE_URL` can select a separate local server; the runner replaces its database name with a fresh test name. Never call integration fixtures directly against a development or production database.

Browser checks require `npm run build`, Chromium (`npx playwright install chromium`), and an available port 4173. `PLAYWRIGHT_CHANNEL=chrome` optionally selects an installed Chrome. Test administrators and customer credentials are confined to test fixtures; no default account is added to the application database.

## Coverage

| Layer       | Behaviors present in the suites                                                                                                                                                                                                                                                                                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | Integer pricing, discounts/free delivery, request validation, bcrypt byte limits, Sri Lankan addresses, safe product images, checkout-key recovery, COD labels, catalog preservation, mocked seeding, local database guards, and native lockfile bindings                                                                                                                           |
| Integration | Authentication, verification/reset/session revocation, ownership/admin restrictions, CSRF/Origin, cart merge, catalog CRUD, authoritative checkout totals, idempotency/concurrency, stock constraints, PayHere signatures/replay/expiry/reconciliation, COD without gateway credentials, shipment/cancellation/collection races, refunds, reviews/moderation, and account disabling |
| Browser     | Public SSR/JSON-LD/canonical links, homepage image URLs and missing-image 404, sitemap/robots, desktop/mobile navigation and focus, registration/verification, persistent cart, intercepted PayHere handoff, admin screens, COD lost-response/reload recovery, order history, fulfillment, and cash collection                                                                      |

Browser screenshots are written to ignored `test-results/screenshots/`; failures can retain traces/screenshots under `test-results/`, with the HTML report in `playwright-report/`. The server log is `.local/e2e-server.log`. No usable application screenshots are included in the supplied snapshot. Review artifacts for personal data and tokens before sharing them.

## Recorded local verification

The [COD implementation report](07-cash-on-delivery.md) records these results from **11 October 2026**, using Windows, Node.js 24.15.0, and npm 11.12.1:

- 36 unit tests across seven files.
- 34 PostgreSQL test results: 32 cases and two parent suites.
- Five browser journeys, plus a separate COD run with empty PayHere credentials.
- Frontend/backend type checks and the complete browser/SSR/API build.

The older 10 October report listed 15 unit cases, 17 PostgreSQL cases plus their parent suite, and four browser journeys. Those counts predate COD and the additional guard tests. Neither report is a remote CI result. The readiness audit repeated the unit checks below, but did not repeat database/browser workflows.

## Readiness audit (11 October 2026)

Fresh checks ran on Windows with Node.js 24.15.0/npm 11.12.1 after restoring the locked dependencies with installation lifecycle scripts disabled:

| Check               | Current result                                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | Passed for both workspaces                                                                                                                                |
| `npm run build`     | Passed: media, Prisma generation, client/SSR bundles, and backend compilation; nonfatal upstream Zod comment-annotation warnings appeared during bundling |
| `npm test`          | Passed: 36 tests across seven files                                                                                                                       |
| `npm audit --json`  | Zero known advisories at the time of the check                                                                                                            |
| Documentation       | 28 local Markdown links resolved; all 11 external links, including four badges, returned HTTP 200                                                         |

Initial type/build attempts could not start because TypeScript and Sharp were absent. Installation hit registry timeouts before completing from the populated cache. The first Vitest attempt was blocked by sandbox directory access; the successful unit run and build used approved broader execution access. These were environment failures, not successful test results. [Project status](06-phase-status.md) contains the release findings and unchanged-source checks.

The readiness audit does not run migrations, seeds, admin bootstrap, the local database helper, integration suites, or browser suites against an existing database. Source review establishes fixture isolation; it does not establish that those suites passed in this audit.

The final pre-publication follow-up repeated `npm run typecheck`, `npm test` (36 tests in seven files), and `npm run build`; all passed after the minimal static image routing fix. A separate compiled-server smoke check passed ten request scenarios covering the four homepage images, exact WebP bytes and cache headers, HEAD/conditional requests, missing files, and private/traversal paths. The check replaced database construction, application listening, and workers with test doubles; it recorded zero database or worker accesses. Regression assertions were added to the existing public-page journey in `tests/e2e/store.spec.ts`. PostgreSQL and full browser suites were not rerun, so the new browser assertions do not yet have a full-suite result.

## CI and external validation

No `.github` directory or GitHub Actions workflow is present in this snapshot. Restore or create CI, run it on GitHub, and retain its actual results before adding a CI badge or claiming automated remote checks. A clean CI job should install locked development/optional dependencies, generate media and Prisma, check types, run unit tests, build, and use dedicated PostgreSQL/Chromium infrastructure for workflow tests.

At the owner's request, the proposed workflow remains an ignored local draft at `.local/prepublication/ci.proposed.yml`; it has not been installed as `.github/workflows/ci.yml`. The draft uses a disposable PostgreSQL service and Chromium, contains no production credentials or deployment steps, and passed YAML syntax parsing. It has not run on GitHub or established Linux compatibility.

The browser PayHere URL is intercepted and signed test notifications target the real backend. This exercises application logic without proving merchant approval, hosted checkout behavior, real callbacks, settlement, SMTP delivery, or Cloudinary access. Follow [PayHere checks](04-payhere.md) and [deployment validation](03-deployment.md).

Safari/iOS, Firefox, screen-reader review, deployed Lighthouse/Core Web Vitals, realistic load, Docker execution, Neon connectivity, and public Vercel hosting remain unverified. Record measured results when those checks are performed.

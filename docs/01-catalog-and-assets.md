# Catalog and assets

`data/products.json` is the maintained seed catalog: 34 products migrated from the original store, including seven detailed product records. Earlier documentation records a byte-for-byte importer comparison and identifies Git baseline `a6dea05` as the original-page archive. This snapshot has no `.git` directory, so those historical checks and the archive cannot be independently verified here. `data/catalog-provenance.json` keeps the known price conflict and supplier capture notes. Historical source-page filenames are provenance metadata, not runtime file dependencies.

## Maintaining products

Edit the JSON directly for intentional catalog changes. Keep unique slugs, integer LKR minor-unit prices (LKR 7,999 is `799900`), descriptions, size labels, colors, featured flags, and ordered image arrays. Each image has `source`, `url`, and `alt`; optional `reference` points to a retained supplier text document. Product descriptions and text references retain the migrated information; external reference prices do not override storefront LKR prices.

Historical catalog pricing discrepancies are documented in the provenance records and should be verified before production deployment.

Run `npm run assets` after editing. It validates product uniqueness, prices, source files, and stable image URLs, then builds ignored `frontend/public/media/` files with Sharp. It reads the catalog without rewriting it. Missing inputs or changed URLs fail the build. `npm run build` includes this step. No legacy HTML parsing or JavaScript evaluation is needed.

Image sources use forward-slash paths beneath `source/`. A filename is the first 16 hexadecimal characters of the SHA-256 hash of that relative source path plus `.webp`; the public URL is `/media/<filename>`. Responsive siblings append `-480` and `-960`; the main image is at most 1600 pixels wide. For example, get the correct filename for a new source with:

```sh
node --input-type=module -e "import { mediaFilename } from './scripts/build-assets.mjs'; console.log(mediaFilename('source/Men/example.jpg'))"
```

Keep existing source paths: renaming a directory changes the derived URLs already stored in databases. When intentionally changing product data, review and update the canonical catalog snapshot hash in `tests/unit/catalog.test.ts`, and record the reason in provenance. The test also checks every gallery input, reference, and responsive derivative. Run `npm run assets` before unit tests in a clean checkout. A future CI workflow must do this too; no workflow is present in this snapshot.

## Seeding and live data

`backend/prisma/seed.ts` reads the same JSON. It creates missing products and variants, starts inventory at zero unless sample stock is explicitly enabled for a non-production database, and preserves existing products/inventory on repeat runs. Editing seed JSON does not update existing live product rows: use administration for live catalog changes. Seeding writes to a database and must not be run as part of a no-database-changes cleanup. Unit tests execute the seed through mocked database calls to check its catalog input and preservation behavior.

## Brand and supplier sources

Keep `source/bacground.webp`, both `source/logo/praveen logo 2*.png` artworks, and `source/logo/icon.jpg`; these build the hero, logos, and favicon. Local fonts are supplied by the actively imported font packages. The monochrome palette, original artwork, product photography, and Fredoka accents remain part of the React application.

Unique alternate product photographs and supplier text documents are retained even when outside the current gallery. They may contain unimported colors, compositions, care details, or products. Their raw prices and fit labels are unverified supplier information, not approved storefront prices, inventory, or size advice. Review them against actual merchandise before adding products or variants. Earlier documentation reports that supplier browser captures were removed after preserving their notes in provenance; recovery from Git history requires the original repository. Confirm permission to publish retained photography and supplier content before public release.

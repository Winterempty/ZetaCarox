# Inventory v2 implementation notes

The Node.js 24 HTTP/SQLite service and security model from v1.2 are retained. `/` serves the new mobile-first inventory UI; `/legacy` serves the original business workspace. Runtime dependencies are Node built-ins plus a vendored ZXing browser bundle served locally. No CDN or build step is needed.

## Storage and migration

- Schema 2 adds `products.barcode` (optional, unique when nonempty) and `sales` with product/price snapshots, quantity, date, actor, note, and integer-cent totals.
- Schema 1 is snapshotted with `VACUUM INTO` before migration. The migration is transactional and all original tables are retained. A newer unsupported schema is rejected.
- Sales insert, stock deduction, movement, audit, and idempotency response commit in the same transaction. Concurrent changes use the product version; stock cannot go negative.
- Original role permissions, password hashing (scrypt), HttpOnly SameSite cookies, CSRF/origin checks, login throttling, SQLite writer lock, and restore session invalidation are retained.
- The default bind is loopback. Use a trusted HTTPS reverse proxy and exact `PUBLIC_ORIGIN` for mobile/network use; do not expose the HTTP port publicly.

## New API

Every POST requires an authenticated admin/staff (unless stated otherwise), JSON, an allowed Origin, `X-CSRF-Token`, and `Idempotency-Key`. Reuse the same key and payload when retrying an uncertain request. Viewer accounts can read reports and history, but cannot mutate stock or preview imports. Backup is admin-only.

| Endpoint | Payload / result |
| --- | --- |
| POST `/api/products` | Existing payload plus optional `barcode`. Validates barcode/SKU collisions. |
| POST `/api/products/:id/edit` | Existing versioned admin edit plus optional `barcode`; omission preserves old value. |
| POST `/api/products/:id/adjust` | `delta`, `reason`, `version`. New UI always sends version; old API callers remain compatible when omitted. |
| POST `/api/import/preview` | `{csv}` → all rows with raw values, normalized validated items or row errors, `valid`, `count`, and signed `token` when valid. No product writes. |
| POST `/api/import/commit` | `{csv,token}`. Revalidates all rows and verifies the preview against the current product snapshot and actor. All-or-nothing insert, movement per product, batch audit. Preview expires on server restart or product changes. |
| POST `/api/sales` | `{product_id,quantity,version,date,note}`. Uses current server price; positive total; no future dates. Returns `{id,total}` in cents. |
| GET `/api/overview?days=7` | `days` 7 or 30, date range, current/previous totals, nullable percentage, up/down/flat direction, daily series, latest 100 direct sales, business day. |
| GET `/api/history?page=1` | All movement history, 50 rows/page, product and actor names, total count. |
| GET `/api/inventory.csv` | Active products, UTF-8 BOM, import-column headers, prices in major currency units, spreadsheet-safe text. |
| GET `/api/export?table=sales&format=display&lang=th` | All direct sales with Thai or English headings and prices in major units. Without `format=display`, raw money values are cents. |

CSV input: at most 256 KB and 500 rows. UTF-8; comma, semicolon or tab delimiter; quoted newlines and escaped quotes; six required headers plus optional barcode. Unknown/duplicate headers, malformed quoting, invalid currency, fractional quantities, duplicate SKUs/barcodes, SKU/barcode collisions, and existing SKUs are rejected. Import adds new products only. Excel may discard leading zeros before export; input SKU/barcode columns as Text. This app cannot reconstruct zeros Excel has removed.

## Sales definition

The trend sums direct sales `total` and active legacy invoices `subtotal` (before tax), using their sale/issued date and the configured business timezone for date boundaries. It excludes void invoices and does not count generic stock-out movements as sales. It is not cash received or profit. The two periods have equal day counts and the current period includes today. A zero comparison base produces `percent:null`, not Infinity or a fabricated percentage.

The direct-sales export includes only v2 direct sales; legacy invoices have their own export. Legacy reports/health remain based on their original invoice/payment/expense definitions, and do not incorporate the new direct-sales table. Do not record the same sale in both workflows. Direct-sale returns/voiding and tax calculation are not implemented in v2's simplified flow; the original invoice workflow remains available for invoice/tax/payment use.

## Browser

New UI: `public/inventory.html`, `inventory.js`, `inventory.css`. English first, remembered optional Thai preference; user-entered names/notes are never translated. Text is escaped before HTML rendering. All runtime scripts/styles are local under the original restrictive CSP. Charts have a labeled SVG and an expandable daily-values table. Product/history tables become cards at phone widths.

Scanner: `getUserMedia` only after explicit start; rear-facing camera preferred; ZXing `BrowserMultiFormatReader.decodeFromStream`. No image upload. Stops tracks on found result, navigation, page hide, manual stop, and async cancellation. Manual lookup remains usable if permission is denied or no camera is available. Sample EAN-13 `8851234567898` is checksum-valid and does not seed the database.

## Primary references

- Node.js 24 SQLite: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
- ZXing browser 0.2.1: https://github.com/zxing-js/browser
- Media capture secure contexts: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia

Third-party licenses are included under `public/vendor/`. The original ZIP is retained under `original/` with its SHA-256 in `ORIGINAL-SHA256.txt`.

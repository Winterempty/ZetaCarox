# HTTP API

Same-origin JSON API. All responses are JSON except static assets, CSV exports and SQLite backups. Error format: `{ "error": "Human-readable message" }`. Errors use 400 validation, 401 unauthenticated, 403 unauthorized/origin/CSRF, 404 missing, 409 conflict, 413 body too large, 415 content type and 429 throttled.

POSTs require `Content-Type: application/json` and the exact browser `Origin`. Authenticated POSTs require the `X-CSRF-Token` returned in the signed-in user and an `Idempotency-Key` (up to 100 characters). Reuse the same key only for a retry of the same endpoint and exact JSON payload. A duplicate returns its original result without repeating business writes; changed payload returns 409. Login/setup/logout do not require an idempotency key. Setup and login do not require a CSRF token.

Authentication uses the HttpOnly `zc_session` cookie. No bearer token or localStorage credential is used. Monetary input values are decimal **strings** such as `"125.50"`; output values are integer minor units. Dates are `YYYY-MM-DD`; tax basis points are integers (700 = 7%).

| Method | Path | Purpose / access |
| --- | --- | --- |
| GET | `/api/health` | Database health, public |
| GET | `/api/session` | Current user and first-run status |
| POST | `/api/setup` | First owner: setupToken, username, name, password |
| POST | `/api/login` | username, password |
| POST | `/api/logout` | End current session |
| GET | `/api/state` | Workspace records and derived totals; signed in |
| POST | `/api/contacts` | name, kind customer/supplier, optional email/phone/address; staff/admin |
| POST | `/api/contacts/:id/edit` | name, email, phone, address, expected (original contact object); staff/admin |
| POST | `/api/products` | sku, name, price, cost, stock, reorder; staff/admin |
| POST | `/api/products/:id/edit` | name, price, cost, reorder, active 0/1, version; admin |
| POST | `/api/products/:id/adjust` | delta signed integer, reason; staff/admin |
| POST | `/api/invoices` | customer_id, issued, due, tax_bps, note, lines; staff/admin |
| GET | `/api/invoices/:id` | Invoice snapshot, lines and payments |
| POST | `/api/invoices/:id/payments` | amount, date, reference; staff/admin |
| POST | `/api/invoices/:id/void` | reason; admin; unpaid only |
| POST | `/api/purchases` | supplier_id, note, lines; staff/admin |
| GET | `/api/purchases/:id` | Order and lines |
| POST | `/api/purchases/:id/receive` | Empty object; staff/admin; ordered only |
| POST | `/api/purchases/:id/cancel` | Empty object; staff/admin; ordered only |
| POST | `/api/expenses` | date, category, payee, amount, note; staff/admin |
| POST | `/api/expenses/:id/void` | reason; admin |
| POST | `/api/settings` | name, currency, address, timezone, version; admin |
| POST | `/api/users` | username, name, password, role; admin |
| POST | `/api/users/:id/access` | role, active 0/1; admin; cannot target self |
| POST | `/api/users/:id/reset-password` | password; admin; cannot target self |
| POST | `/api/password` | current, password; changes own password and ends all sessions |
| GET | `/api/export?table=products` | CSV; table allowlist in app; audit admin-only |
| GET | `/api/backup` | Consistent SQLite download; admin only |

Invoice lines: `{ "product_id": 1, "quantity": 2, "expected_price": 12550 }`. Expected price is an optional optimistic check, not an override. Purchase lines: `{ "product_id": 1, "quantity": 10, "cost": "60.00" }`. Distinct product IDs are required within an order. All state-changing business writes, stock movements and audit rows commit in one database transaction.

The API is currently a same-origin application API, not a versioned public integration contract. `GET /api/state` loads all products, contacts, invoices, payments, expenses and purchase orders; activity/movements are limited to the latest 100, with full CSV history available. List pagination is client-side. Implement server pagination before adopting large datasets.

## Display CSV exports (v1.1)

The UI now uses `/api/export?table=invoices&format=display&lang=th` (or `lang=en`). These exports have readable localized column headings and monetary amounts in major units with two decimals, not satang/cents. Invoice exports include balance due and computed payment status. Business names and notes stay unchanged. Cancelled/voided records remain in the file and should be filtered before summing.

The original export without `format=display` retains machine column names and minor-unit monetary values for integrations. Negative numeric stock movements remain numeric; text fields are spreadsheet-formula-neutralized.

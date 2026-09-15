# ZetaCaros 2.0 — inventory, made simple

A mobile-first stock and sales manager for small shops. Built on the supplied ZetaCaros business v1.2, with its login, backup system, database records, and legacy workspace preserved.

**Runtime: Node.js 24 LTS. Tested on Windows with Node.js 24.21.0.**

## Start on Windows

1. Install Node.js **24 LTS** from https://nodejs.org/en/download (select 24, not Current).
2. Extract the whole ZIP into a new folder. Do not overwrite an existing shop installation.
3. Open the `ZetaCaros` folder and double-click **START-WINDOWS.cmd**.
4. When the server says ready, open **http://localhost:3000** in Edge or Chrome.
5. Copy the first-run setup code from the server window and create your owner account. Use a password of 12–128 characters.

No `npm install`, build step, Docker, or external database is needed for normal use. Keep the server window open; press Ctrl+C to stop it.

**[คู่มือภาษาไทย / detailed Windows, migration, and backup guide](WINDOWS-TH.md)**

## Included

- Product management, on-hand quantities, and complete stock movement history.
- Yellow low-stock and red out-of-stock alerts, each with text.
- UTF-8 Excel CSV import with full validation and preview, then atomic confirmation; exportable inventory, sales and history.
- Camera barcode lookup with a bundled local ZXing decoder, a real EAN-13 sample, and manual entry. Scanning alone never changes stock.
- Confirmed direct sales that deduct stock and record history together.
- Real 7/30-day sales trends, including active legacy invoice subtotals. Explicit zero-base handling and daily data table.
- English first, an easy Thai toggle, and Slate/Indigo layouts with phone-friendly cards.
- Existing login roles, CSRF/origin checks, password management and SQLite backup/restore.
- Original business workspace at `/legacy` for invoices, purchases, contacts, expenses and user administration.

Production starts empty. Sample CSV and barcode are in `samples/` and are never loaded automatically.

## Existing data

The exact supplied ZIP is retained under `original/`; its SHA-256 is recorded in `ORIGINAL-SHA256.txt`. The supplied ZIP contained no shop database.

Back up the running v1.2 shop using its backup button, stop the old server, then restore the backup into this **separate** installation:

```powershell
npm run restore -- "D:\\Shop backups\\business.sqlite" --confirm
npm start
```

Restoring retains the current database before replacement and invalidates old sessions. Opening a v1 database creates a pre-migration SQLite snapshot, then adds schema 2 without deleting original tables or records. Sign in using the account from the backup.

Do not open schema 2 with the old app. To roll back, use the original app and the retained schema-1 snapshot. This does not include new transactions made after migration.

## Backups and operational scope

Use **Settings → Download backup** while running, or stop the server and run `npm run backup`. Do not copy a live SQLite file without its WAL; use a consistent backup. Default storage is `data/business.sqlite`.

A local Windows launch binds to loopback. Using a phone requires a trusted HTTPS reverse proxy and an exact `PUBLIC_ORIGIN`; localhost on your phone is not your Windows computer. See WINDOWS-TH.md for configuration. No hosting, TLS certificate or proxy is provisioned by this ZIP.

CSV import only adds new SKUs; it deliberately does not overwrite existing quantities. Prices in the inventory/display CSV are major units; raw legacy exports retain integer cents. Set SKU/barcode columns to Text in Excel to retain leading zeros.

The new sales graph measures sales value before tax, not cash or profit. Do not enter the same sale both as a direct sale and a legacy invoice. Direct-sale voids/returns are not implemented; use the legacy invoice workflow if your process needs its invoice, tax, payment and unpaid-invoice void features. Legacy business reports retain their original financial definitions; new direct-sales reports are on the Sales screen.

## Verification

```powershell
npm test
# Optional browser/legacy DOM checks:
npm ci
npm run test:ui
npm run test:legacy-ui
```

The browser suite uses installed Microsoft Edge on Windows; on other platforms, run `npx playwright install chromium` first. Tests use separate temporary databases.

See **TEST-RESULTS.md** for actual checks and remaining hardware limitations. See **docs/INVENTORY-V2.md** for the API and implementation. Documents describing v1 behavior are retained in the original ZIP and the legacy docs.

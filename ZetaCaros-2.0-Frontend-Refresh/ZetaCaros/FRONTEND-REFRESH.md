# Frontend refresh — 15 September 2026

ZetaCaros 2.0 now has a lighter Slate and Indigo inventory dashboard focused on physical stock and everyday shop tasks.

- Clearer inventory totals, with clickable cards for all, low-stock, and out-of-stock products.
- Dashboard search by name, SKU, or barcode.
- Receive-stock and record-sale shortcuts.
- Direct stock adjustment from the low-stock list, retaining the review/confirmation step.
- Refined typography, spacing, white panels, Slate stock-count card, and Indigo navigation/actions.
- Mobile cards and bottom navigation, with English and Thai preserved.

Only `public/inventory.js` and `public/inventory.css` need replacing in an existing 2.0 installation. No backend, schema, account, or database migration is required. Keep your `data` folder intact. Refresh the browser after updating (Ctrl+F5 if needed).

For a new installation, extract this complete ZIP and follow WINDOWS-TH.md. Do not extract the entire package over another installation's data.

Verification: 23 real-browser checks passed on Windows/Edge with Node.js 24, including the three new shortcut/search checks, all six views in English/Thai, and 390/768px mobile/tablet layouts. The original 50-test report is retained in TEST-RESULTS.md; this revision changes only the frontend. Test screenshots use synthetic data.

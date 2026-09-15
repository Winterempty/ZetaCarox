# ZetaCaros 2.0 — verification

Verified on 14 September 2026 with **Windows, Node.js 24.21.0, npm 11.19.0, Microsoft Edge (headless), Playwright 1.63.0**.

## Automated API and unit checks

`npm test`: **50 passed, 0 failed**. No extra packages required for this suite.

- All 37 original business, frontend-rendering, and business-health regression tests pass.
- 13 new inventory tests cover empty production state; UTF-8/BOM CSV with quoting, delimiters, malformed input, and row limits; read-only preview; required preview token; no partial writes; duplicate/invalid/existing rows; leading barcode zeros; stale preview rejection; barcode/SKU collision rejection; old-client edit compatibility; atomic and idempotent sales; stale/future/overselling rejection; real date-range trends; zero baseline; legacy invoice inclusion and void exclusion; concurrent last-item selling; viewer restrictions; paginated full history; spreadsheet-safe exports; backup integrity; schema-1 migration snapshots; and restoring a schema-1 backup into a new installation without modifying the source file.

## Real browser checks

`npm run test:ui`: **20 grouped checks passed**.

1. English-first owner setup and empty dashboard without invented sales.
2. Product creation through UI, decimal money, and barcode entry.
3. Review/Cancel leaves inventory unchanged.
4. Confirmed stock receipt updates quantity and history.
5. Sample EAN-13 decodes using the actual ZXing library; lookup does not mutate stock.
6. A synthetic video MediaStream containing the barcode passes through the actual camera decode path; all tracks stop after matching.
7. Denied camera access has a manual-entry fallback; unknown barcode has a clear result.
8. Sale from barcode lookup reviews the exact total before deduction.
9. Invalid CSV displays row errors and disables commit.
10. Valid CSV previews values and commits only after confirmation.
11. Barcode search preserves leading zeros; yellow and red statuses include text.
12. Dated sales produce a real decline and a 30-day zero-baseline comparison.
13–14. All six main screens render in Thai and English.
15–16. All six screens fit 390px and 768px viewports without horizontal page overflow; desktop captured at 1440px. Product/history rows become mobile cards.
17. Inventory CSV downloads with barcode zeros intact.
18. Backup download passes SQLite integrity/schema checks.
19. Language survives reload; logout and Thai invalid-login errors work.
20. No JavaScript page errors or Content Security Policy errors.

Screenshots were visually inspected for desktop overview, Thai mobile overview, and Thai mobile product cards. QA data is synthetic and is **not** included in the shipping database; the release contains no database or test user.

## Original UI interaction checks

`npm run test:legacy-ui`: **PASS**. The original DOM interaction suite covers setup, language persistence/draft retention, password visibility, larger text, shop settings, Thai product entry and IME search, contacts, invoice creation/printing, payment errors/retry, all nine legacy screens in both languages, health actions, contact edits, exports, and expenses.

## Packaging and data protection

- Original ZIP retained unchanged with SHA-256 recorded in ORIGINAL-SHA256.txt.
- No existing shop database was present in the supplied ZIP; migration/restore were tested against synthetic schema-1 fixtures.
- Shipping archive excludes node_modules, temporary test databases, sessions, credentials, and development runtime state.
- Runtime has no npm production dependency installation; the pinned ZXing decoder and license notices are included locally. An npm production audit has no declared dependency findings; it does not scan the vendored bundle.
- The extracted shipping package is checked with the same 50-test suite and a fresh-server HTTP smoke test.

## Limits of verification

- No physical webcam, phone camera, iOS Safari device, printer, or Microsoft Excel UI was used. Barcode recognition was verified against an actual rendered EAN-13 and a simulated video stream; CSV was verified programmatically and by a browser download.
- Mobile checks are viewport/browser emulation, not deployment to a phone. Network HTTPS/reverse proxy and a trusted mobile certificate must be configured separately.
- No live shop data was migrated, and this is not a load test for large enterprises. State loading is intended for a small shop; history is paginated, direct-sales UI lists the most recent 100, and exports contain the complete corresponding table.
- Direct sales do not implement returns/voids or tax. Legacy invoices retain their existing unpaid-invoice void workflow. Legacy financial reports retain their original scope.

See WINDOWS-TH.md before switching an existing shop to this release.

# Release verification · 1.2.0

## Standard automated tests

Runtime: Node.js 24.19.0 on Linux. `npm test`: **37 passed, 0 failed**.

The suite uses temporary databases and checks money validation; authentication and CSRF; inventory; invoice totals and tax rounding; payments and overpayment rejection; stock rollback, void/restock and concurrent overselling protection; purchase receiving; expense voiding; roles and session invalidation; backups and restore; contact edits with unchanged invoice snapshots; raw and localized CSV exports; safe local delivery of the translation script; both languages and preference behavior; escaped text; viewer controls; localized errors and numeric formatting; and read-only dialog submission prevention.

Database schema remains version 1. No production data was used. The ZIP contains no live data folder or generated account credentials.

Additional 1.2 checks cover completed-month boundaries, current-month separation, year rollover, missing records, zero/negative comparison bases, neutral expense trends, void exclusion, overdue remaining balances, seven-day due alerts, archived stock exclusion and SVG gaps/negative values.

## DOM interaction checks

**Result: passed.** An additional `jsdom` interaction script is included at `backend/tests/ui-dom.cjs`. This checks actual generated form controls against a temporary running backend using an emulated DOM. It covers language switching and remembered preferences, unsaved form retention, password visibility, setup, text-size selection, business settings, Thai products and search composition, untranslated customer names, invoice/print text, read-only Enter handling, Thai overpayment errors and successful retry, all nine screens in both languages, contact editing, localized export links, expenses, historical invoice trends, graph metric selection and action navigation.

To run this optional development check:

```sh
npm install --no-save --package-lock=false jsdom
npm run test:ui
```

`jsdom` is not a runtime dependency. Normal startup and `npm test` need no npm installation.

## Browser and visual limitations

The connected Chrome browser could not access the local preview: it reported `net::ERR_BLOCKED_BY_CLIENT` for the loopback address. No browser bypass was attempted. DOM emulation does not verify pixel layout, mobile rendering, actual keyboard IME behavior, accessibility-tree behavior, printer pagination or font appearance on Windows. Those remain a manual review step on the user's device.

The earlier optional Playwright smoke script is retained for a developer with a locally usable browser. No screenshot or full browser-test pass is claimed in this release.

## Not performed

- GitHub push, merge, hosting deployment or changes to the user's running installation.
- Windows launcher execution, load testing for a medium-sized organization, penetration testing or accounting/tax certification.

Use UPDATE.md to preserve your existing installation. Back up before replacing files, retain `data`, restart, then press Ctrl+F5.

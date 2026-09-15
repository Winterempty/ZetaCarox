# 1.2.0 — Practical business guidance

- Added Business health / ดูแนวโน้มธุรกิจ, with a visible entry on Overview.
- Added six completed months of selectable SVG graphs for invoice sales before tax, customer receipts, recorded expenses and recorded cash differences, plus exact monthly tables.
- Kept current-month activity separate from completed-month comparisons.
- Added percentage/direction indicators with safe treatment of missing records, zero and negative bases, and neutral interpretation of expense changes.
- Added prioritized checks for overdue/soon-due invoices, low stock, prices below reference cost, negative recorded cash difference, lower recorded sales and missing reference costs. Each action opens the relevant existing screen or oldest overdue invoice.
- Added a top-five expense-category breakdown for the last completed month.
- Preserved English/Thai language and text-size controls, existing roles and database schema.
- No automatic transactions, tax estimates, profit claims or outside AI service.

# 1.1.0 — Thai/English usability update

- Added English/ไทย language controls on sign-in and the main header. English is the default for a new browser; the selected language is remembered locally.
- Added readable Thai copy for navigation, forms, confirmations, statuses, validation, common server errors, invoice print text and report headings. Business names, notes, references and saved enum values are preserved.
- Increased primary text to 16px, controls to roughly 15–16px, secondary text to 14px, and added a Larger mode based on an 18px root size. Improved Thai line spacing and responsive form layout.
- Added show/hide password controls and clearer first-time setup instructions.
- Preserved unfinished main-page form values when switching language; preferences never store passwords or form values.
- Fixed Thai IME search interruption, read-only dialog Enter submission, retry-key invalidation after adding an invoice line, and editing/closing a modal during a save.
- Added contact editing with stale-update protection. Existing invoice/contact snapshots remain unchanged.
- Made UI CSV downloads use localized headings, decimal amounts in business currency and computed invoice balances/statuses. Original machine CSV remains available through the existing API format.
- Added Thai quick-start and bilingual update instructions.
- No database schema change; preserve the existing data folder during update.

Validation details and remaining limitations are in VERIFICATION.md.

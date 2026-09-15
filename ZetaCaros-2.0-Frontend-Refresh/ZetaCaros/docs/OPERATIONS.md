# Operating ZetaCaros v1.1

## Deployment and access

The default is one locally operated application, bound to `127.0.0.1:3000`. Do not share the SQLite file across computers or run multiple app processes. The lock file prevents two cooperating processes from opening the same business database. It is not protection against arbitrary external SQLite tools.

For a shared installation, use a dedicated host with Node.js 24.x, persistent local storage and an HTTPS reverse proxy managed by your administrator. Set the exact external origin, for example:

```sh
PUBLIC_ORIGIN=https://business.example.com HOST=127.0.0.1 PORT=3000 npm start
```

The reverse proxy must terminate TLS, forward the original `Host` header, proxy to `127.0.0.1:3000`, set suitable request/time limits and have a valid certificate. Keep the backend port inaccessible from untrusted networks. The app only accepts the configured external host or loopback hosts, and write requests require a matching Origin and CSRF token. Configured public origins must use HTTPS. Sessions receive the Secure cookie flag under this configuration.

If the proxy is on another host/container, bind intentionally with `HOST=0.0.0.0`, configure `PUBLIC_ORIGIN`, and restrict the backend network to the proxy. This is not a complete deployment manifest. No hosting account, DNS or certificate has been configured in this delivery.

The `.env.example` file documents variables but is not automatically loaded. Set variables in your process manager or shell. `DB_PATH` should be an absolute path on persistent local disk. Run under a dedicated non-administrator operating-system account. Restrict the data directory and backups using OS permissions; Windows administrators should configure directory ACLs because POSIX mode flags do not implement Windows ACL policy.

Authentication is password-based, with scrypt hashes, 8-hour fixed sessions, server-side active-user checks and a per-connection-IP login/setup throttle (15 attempts per 15 minutes). Behind a proxy this throttle may group users; implement appropriate edge rate limiting. There is no MFA, email recovery, session-device UI or external identity provider. Owner recovery requires another administrator account. Database administrators can change records; the audit log is operational history, not tamper-proof evidence.

## Back up and recover

**Backups are manual in this release.** Assign a person to take them daily, retain weekly/monthly copies, and periodically test restoration. Monitor disk usage: browser downloads also retain a server-side snapshot under `data/backups`, with no automatic retention cleanup.

While running, an admin can download a consistent SQLite snapshot from Reports or Settings. The download includes all business data and password hashes; treat it as confidential. Transfer a copy to a separate protected device or approved backup destination.

For an offline backup:

```sh
# Stop the server first.
npm run backup
```

To restore:

1. Stop the server with Ctrl+C. Ensure no process is running for this database.
2. Preserve the current data folder independently.
3. Run:

```sh
npm run restore -- /absolute/path/to/business-backup.sqlite --confirm
```

4. The utility validates SQLite integrity, foreign keys, schema version and required tables. It stages the backup, clears login sessions, and retains the previous database beside the restored file with a `before-restore` suffix.
5. Restart, sign in, and compare invoice counts, stock levels and outstanding balances against the chosen backup date. Changes after that backup will not be present.
6. Keep the previous database until you have accepted the restore. If needed, repeat the restore using that retained file.

Only restore trusted application backups. Do not edit or copy the active SQLite file alone while the server is running: WAL state can be required. The backup route and maintenance utility produce coherent snapshots. A stale lock after a crash must be removed only after checking that the application is stopped.

There is no scheduled task installed by this package and no automatic remote backup service.

## Business rules

- One business, one locked accounting currency, one stock location. Supported currencies use two decimal places.
- Quantities are whole units. Stock limits are 0–1,000,000 units per product. Individual quantities are capped at 100,000 per order line; at most 100 distinct product lines per invoice/order.
- Input prices/expenses accept up to 8 whole digits and 2 fractional digits; aggregate invoice subtotal/order total is capped at 100,000,000,000 minor units. No floating-point money is stored.
- Invoice numbers and purchase order numbers are database IDs with `INV-` / `PO-` prefixes. Records are retained rather than deleted. This numbering is not represented as jurisdiction-certified tax numbering.
- Invoice prices come from the current product record. The UI sends its displayed expected price; a changed price blocks issuance until refresh. Issued names, addresses, currency, prices and costs are snapshots.
- Tax is one explicit invoice-level percentage, rounded half-up to the nearest minor unit. No tax rules are inferred, and no statutory tax filing is performed.
- Issuing reserves no separate stock: it immediately deducts units. Unpaid invoice voiding returns them. Paid invoices cannot be voided; refunds and credit notes are outside scope.
- Payments cannot exceed the active invoice's remaining balance and cannot predate the issue date or be future dated. They record money received; there is no payment gateway.
- Full purchase receiving happens once, atomically. It does not change reference costs or create expenses. Pay the supplier outside the app and enter the cash expense separately.
- Reference stock value is stock × manually maintained reference cost, not FIFO/weighted-average accounting valuation. The dashboard's cash difference is recorded receipts minus recorded expenses; it excludes unentered cash, opening balances, financing and other movements.
- Contacts can be edited with conflict protection; their customer/supplier type remains fixed. Products can be edited/archived; invoices and purchase orders keep their original contact names. Contact merging, bulk import, bank sync and tax compliance are future work.
- Business dates use the configured IANA time zone (Bangkok by default); activity timestamps are UTC. Currency cannot change after product/financial records exist. All users share the business time zone.
- Roles are admin/staff/viewer. Staff and viewers can see all business data; this is not department-level or field-level access control. Viewer financial exports are allowed; only admins export audit logs or databases.

## Rollout for a real business

Before a live pilot, use a separate test database and compare a representative day's sales, tax, receiving, voids, expenses and closing balances with your current process. Check owner/team permissions, test backup restoration, and print invoices on the actual printer. Have the person responsible for your accounts approve the invoice format and operational calculations for the intended use.

The delivered tests verify data integrity and common flows, not production capacity, regulatory compliance, penetration-test certification or every browser/OS. No concurrent medium-business load benchmark has been run. The current full-state API is suitable for initial modest-volume use; larger datasets require paginated queries, indexes based on observed workload, reporting queries and measured capacity limits. Stronger deployment monitoring, automated backup retention, disaster recovery ownership, MFA/SSO and externally retained audit logs should be added according to the organization's needs.

## Updates

1. Download and verify a backup.
2. Stop the application.
3. Replace source files, keeping the existing data directory and environment configuration.
4. Run tests against temporary databases, then start the application and check `/api/health`.
5. Confirm key records and balances before staff resume.

Schema is versioned with SQLite `user_version`. This release creates schema version 1 and rejects a newer schema. Future schema changes must ship tested forward migrations and a rollback/restore plan.

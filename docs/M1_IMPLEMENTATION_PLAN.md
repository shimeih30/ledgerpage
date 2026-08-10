# LedgerPage — M1 Implementation Plan (Reconstructed)

**Status:** Proposed, pending owner review. Not frozen.

## Important note on provenance

The original M1 implementation plan and Decision Log referenced earlier in
this project appear to have been misplaced. **This document is a fresh
reconstruction**, built from:

- the current repository's actual code, schema, migrations, and tests
  (Slices 1–4, all merged and passing);
- the LedgerPage product context supplied for this reconstruction;
- standard sequencing principles for a manufacturing ERP (foundational
  data → master data → transactional flows → accounting → reporting).

It is **not** a recovery of whatever the original document said, and
should not be treated as such. Where earlier project decisions are
already encoded in the shipped code (e.g. table names, ID conventions,
timestamp format), this plan follows them for consistency. Where a real
business decision is still open, it is marked explicitly rather than
guessed.

## Revision log

- **Rev 1 (initial reconstruction).** Slices 5–31 proposed.
- **Rev 2 (this revision), documentation-only, before Slice 5 begins:**
  1. Company singleton now enforced at both database and service level
     (stable ID `primary_company`, SQLite `CHECK` constraint).
  2. Document-numbering defaults for 10 document types adopted as newly
     approved decisions (previously miscast as "confirmed defaults" with
     no actual prior confirmation).
  3. Accounting foundations (chart of accounts, general ledger, posting
     framework) moved earlier in the roadmap, ahead of any module that
     posts real financial transactions. Every transactional slice from
     Purchasing onward now includes its own posting rules and tests as
     part of that slice, rather than a separate later "auto-posting"
     slice. All remaining slices renumbered; dependencies and
     cross-references updated throughout.
  4. Currency behavior clarified: USD remains the sole functional/posting
     currency for M1; ZWG, ZAR, BWP, CNY remain reference-only data with
     no transactional meaning unless separately approved.
  5. Slice 5's original scope, name, and exclusions reconfirmed
     unchanged in substance (no UI, no seeded company PII, tax stays a
     separate slice, no users/roles/auth, no preload/renderer database
     access).

---

## 1. Completed and approved (Slices 1–4)

| Slice | Name                           | Delivered                                                                                                                                                        |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Application shell              | Electron + React + TypeScript shell, static renderer, tooling (lint/format/test/build)                                                                           |
| 2     | Secure Electron shell          | `contextIsolation`, `sandbox`, disabled `nodeIntegration`, CSP (prod + dev split), navigation/IPC-sender allow-listing, single narrow preload API (`getAppInfo`) |
| 3     | SQLite and migration bootstrap | `better-sqlite3` + Drizzle, WAL mode, foreign keys on, forward-only migrations via `schema_migrations`, single-instance lock, safe startup-error path            |
| 4     | Reference data                 | `currencies`, `units_of_measure`, `payment_methods`, `expense_categories` — idempotent seeding, stable text IDs, no business tables yet                          |

**Confirmed absent from the repository today:** companies, users, roles,
products, inventory, suppliers, customers, orders, recipes, production,
expenses, accounting, taxes, payroll. Every slice below assumes this
starting point. **This revision does not alter Slices 1–4 in any way.**

## 2. Product context driving this roadmap

- Desktop-first, offline-first manufacturing ERP for a small team (owner +
  a few executives).
- Scale: ~20 products (with variants — e.g. 100 ml / 200 ml / 2 L),
  ~150 inventory items, ~500 customers, ~60 production batches per
  product per month.
- Some products may be services (no physical stock, no recipe).
- Needs: inventory with fluctuating costs, batch/production costing,
  expenses, purchasing, sales (cash and credit), suppliers, salaries and
  payslips, VAT and non-VAT operation, useful accounting reports, audit
  history.
- Zimbabwe-oriented, but configurable enough to sell to other businesses
  later — nothing region-specific should be hard-coded into core logic.
- No cloud or multi-device sync in this roadmap.

## 3. Sequencing principles applied

1. Foundational company/user/authorization concepts before any
   operational module.
2. Products, inventory, suppliers, and customers (non-financial master
   data) before recipes and production.
3. **Accounting foundations (chart of accounts, general ledger, posting
   framework) exist before any module that can post a real financial
   transaction** — purchasing (receiving), production completion,
   invoicing, payment, and expense recording. This is new in this
   revision; see §5.
4. Customers and sales before full accounting reports (reports need real
   transactions to report on).
5. Accounting foundations before payroll or advanced reporting — payroll
   posts to the ledger; reports read from it.
6. Each slice touches one coherent domain. Where two concepts are small
   and inseparable (e.g. purchase orders + goods receipts + their
   posting rules), they share a slice; where a domain is genuinely large
   (e.g. production), it is split across planning vs. recording.
7. A dedicated final slice handles packaging, backup, restore, and
   Windows compatibility — deliberately last, once the schema has
   stopped changing.

## 4. Roadmap at a glance (revised)

| #   | Slice                                                          | Tier         |
| --- | -------------------------------------------------------------- | ------------ |
| 5   | Company Profile & Document Numbering                           | Foundational |
| 6   | Tax Configuration                                              | Foundational |
| 7   | Authentication Foundations                                     | Foundational |
| 8   | First-Run Setup Wizard & Owner Recovery                        | Foundational |
| 9   | Users, Roles & Login                                           | Foundational |
| 10  | Audit Logging Foundation                                       | Foundational |
| 11  | Products & Variants                                            | Master data  |
| 12  | Inventory Items                                                | Master data  |
| 13  | Suppliers                                                      | Master data  |
| 14  | Customers                                                      | Master data  |
| 15  | Inventory Lots & Stock Ledger (FIFO)                           | Master data  |
| 16  | Accounting Foundations: Chart of Accounts & General Ledger     | Accounting   |
| 17  | Accounting Posting Framework                                   | Accounting   |
| 18  | Purchasing: Orders, Direct Purchases, Goods Receipts & Posting | Purchasing   |
| 19  | Recipes / Bills of Material                                    | Production   |
| 20  | Production Planning & Next Production Assistant                | Production   |
| 21  | Production Batches & Posting                                   | Production   |
| 22  | Sales: Quotations & Sales Orders                               | Sales        |
| 23  | Sales: Invoices, Deliveries, Payments & Posting                | Sales        |
| 24  | Expenses & Posting                                             | Accounting   |
| 25  | Accounting: Core Financial Reports                             | Accounting   |
| 26  | Payroll Foundations & Posting                                  | Payroll      |
| 27  | Business Health Dashboard                                      | Reporting    |
| 28  | Business Alerts                                                | Reporting    |
| 29  | Returns & Credit Notes (Supplier and Customer) & Posting       | Hardening    |
| 30  | Sensitive-Action Approvals & Roles Hardening                   | Hardening    |
| 31  | Packaging, Backup, Restore & Windows Compatibility             | Final        |

27 slices remain — the same count as the prior revision. Moving
accounting earlier removed one slice (the old standalone "auto-posting"
slice) and added one (the new "Accounting Posting Framework" foundation),
net zero change in total count.

### §5. Why accounting moved earlier, and where the line is drawn

The prior revision let purchasing, production, sales, and expenses create
real transactions before any ledger existed, risking operational records
that could never be represented in accounting. This revision draws the
line as follows:

- **Allowed before accounting exists** (non-financial, nothing to post):
  company profile, tax _configuration_ (codes/rates exist but nothing is
  charged yet), authentication, first-run setup, users/roles, audit
  logging, and master data — products, inventory items, suppliers,
  customers, and the inventory lot/FIFO _engine_ itself (a mechanism, not
  a transaction — it posts nothing on its own; it is _used by_ purchasing
  and production, which do post).
- **Requires accounting to already exist:** purchasing (specifically,
  goods receipts — a PO alone still doesn't move inventory or money),
  production batch completion, sales invoicing and payment, expense
  recording, payroll, and returns/credit notes.
- **Recipes and Sales Orders/Quotations** are non-posting by design (a
  recipe is a formula; confirming a sales order reserves stock but posts
  nothing) and could technically sit on either side of the accounting
  gate. This revision keeps them in their originally-reasoned position —
  Recipes after Purchasing (per the standing "products/inventory/
  suppliers/purchasing before recipes/production" principle) and Sales
  Orders grouped with Sales Invoicing (both already fall after the
  accounting gate regardless, since Purchasing does) — rather than
  scattering the Sales or Production domains across the accounting
  boundary for a distinction that has no practical effect here. **This
  placement is a judgment call, flagged for owner confirmation if a
  stricter reading was intended** (see §8).

---

## Tier A — Foundational

### Slice 5 — Company Profile & Document Numbering

**Objective.** Establish the single-company profile and the document
numbering system every later transactional table will depend on, with
the singleton rule enforced at both the database and service level, and
document-numbering defaults frozen as approved decisions.

**Tables introduced.**

- `company` — singleton row, identified by a fixed, stable ID rather than
  a generated one:
  - `id TEXT PRIMARY KEY CHECK (id = 'primary_company')` — the `CHECK`
    constraint means no row with any other ID can ever be inserted, and
    the `PRIMARY KEY` means no second row can be inserted even with the
    correct ID. Both failure modes are rejected by SQLite itself, not
    only by application code.
  - `name`, `trading_name` (nullable), `address`, `contact_details`,
    `currency_id` (FK → `currencies`), `vat_registered` boolean, `logo_asset_path`
    (nullable text — a managed relative file path, never a database
    blob), `created_at`, `updated_at`.
  - **No row is inserted by this slice.** The table exists, and is
    fully exercised by tests using disposable fixture data, but the
    real company row — with Farmer Ben's actual name, address, contact
    details, currency selection, and any logo — is created only by
    Slice 8's first-run setup transaction. Slice 5 must not seed any of
    that information.
- `numbering_rules` — one row per document type:
  - `id TEXT PRIMARY KEY` (stable, e.g. `numbering_rule_quotation`),
    `company_id` (FK → `company.id`), `document_type_key` (unique per
    company), `prefix`, `padding_length`, `reset_behavior`
    (`never` | `yearly`), `current_sequence_value`, `created_at`,
    `updated_at`.
  - Same principle as `company`: the table, service, and allocation
    logic are fully built and tested here using disposable fixture
    rows. The 10 real numbering-rule rows below are **seeded by Slice
    8's first-run transaction**, alongside the real `company` row,
    since `numbering_rules.company_id` cannot reference a company that
    doesn't exist yet.

**Approved document-numbering defaults** (newly approved by this
revision — not a recovery of an earlier confirmation):

| Document type    | Key                | Prefix | Example           | Reset  |
| ---------------- | ------------------ | ------ | ----------------- | ------ |
| Quotation        | `quotation`        | `QT`   | `QT-2026-000001`  | yearly |
| Sales order      | `sales_order`      | `SO`   | `SO-2026-000001`  | yearly |
| Invoice          | `invoice`          | `INV`  | `INV-2026-000001` | yearly |
| Delivery note    | `delivery_note`    | `DN`   | `DN-2026-000001`  | yearly |
| Purchase order   | `purchase_order`   | `PO`   | `PO-2026-000001`  | yearly |
| Goods receipt    | `goods_receipt`    | `GRN`  | `GRN-2026-000001` | yearly |
| Production batch | `production_batch` | `BAT`  | `BAT-2026-000001` | yearly |
| Customer         | `customer`         | `CUS`  | `CUS-000001`      | never  |
| Supplier         | `supplier`         | `SUP`  | `SUP-000001`      | never  |
| Product          | `product`          | `PRD`  | `PRD-000001`      | never  |

> This table supersedes any earlier informal numbering mentions in prior
> project discussion (e.g. a `QUO-` quotation prefix or a `PB-`
> production-batch prefix appeared in earlier draft notes). This
> revision's table — `QT` and `BAT` respectively — is the single
> authoritative source going forward.

Document types not in this table (payments, expenses, journal entries,
credit notes, supplier invoices, payslips) are **not** numbering-enabled
by Slice 5. Each later slice that introduces one of those document types
adds its own `numbering_rules` row at that time, following the same
rules below — this is additive seed data, not a schema or migration
change, so it does not require revisiting Slice 5.

**Approved numbering rules** (apply to every document type, both those
seeded now and those added later):

- Yearly-reset sequences use the application's current UTC year and
  restart at 1 for a new year; never-reset sequences continue across
  years indefinitely.
- Sequence padding is 6 digits for every document type (including the
  `never`-reset ones — `CUS-000001`, not `CUS-00001`).
- A number is allocated only at posting/confirmation time, never at
  draft creation — a draft quotation or unconfirmed order consumes no
  number.
- Allocated numbers are never reused, including after a void or delete.
- Voiding or deleting a posted record does not decrement the sequence.
- Allocation happens inside the **same SQLite transaction** as the state
  change that makes the record permanent (e.g. confirming a sales
  order) — never as a separate step before or after.
- An unsupported/unknown `document_type_key` is rejected by the
  allocation service, not silently ignored.
- `numbering_rules` rows use stable, human-readable IDs (see table
  above), not random ones — consistent with Slice 4's convention.
- A prefix may be edited later through a settings screen (not built in
  this slice); editing a prefix must not reset `current_sequence_value`.

**Services introduced.**

- `companyService` — reads/updates the single `company` row. The public
  API never accepts an `id` parameter from any caller; internally it
  always operates on the fixed ID `primary_company`. There is no code
  path through this service capable of creating or referencing a
  differently-identified company row. Enforces "exactly one row may
  exist" as a natural consequence of the DB constraint plus never
  offering an alternate ID.
- `numberingService` — `allocateNext(documentTypeKey)`, atomic,
  transactional, implementing every rule above. Rejects unsupported
  keys with a clear error rather than allocating a malformed number.

**UI introduced.** None. Company profile editing and the numbering
settings screen ship later (Slice 8's wizard for initial company entry;
a settings screen in a later slice for ongoing edits). This slice is
schema, migration, service, and tests only — matching how Slice 4
shipped without UI.

**Dependencies.** Slice 4 (`currencies` table, for `company.currency_id`).

**Explicit exclusions.**

- No `company` row is seeded — no real name, address, contact details,
  or logo for Farmer Ben's or any other business.
- No `numbering_rules` rows are seeded with a real `company_id` (the
  table and its 10 approved defaults are documented and tested here;
  actually inserting them happens in Slice 8).
- Multi-company switching.
- Logo upload UI (only the managed-asset-path _field_ exists at this
  slice; the copy/validate/replace workflow is a later UI concern).
- Tax fields and tax logic (Slice 6 — kept as a separate slice, per
  owner instruction).
- User/owner concept, authentication, roles (Slices 7–9).
- Any preload or renderer-exposed database API.

**Acceptance criteria.**

- A direct SQL `INSERT` attempting a `company` row with any `id` other
  than `'primary_company'` is rejected by the database (`CHECK`
  constraint violation), proven by a test that performs this insertion
  directly against the database, not through the service layer.
- A direct SQL `INSERT` attempting a **second** `company` row using the
  correct `id` (`'primary_company'`) is also rejected by the database
  (`PRIMARY KEY` violation), proven the same way.
- `companyService` exposes no method capable of creating or fetching a
  company by any ID other than the fixed one — verified by inspecting
  its public API surface in tests, not merely by behavior.
- `numberingService.allocateNext('sales_order')` against a disposable
  test fixture returns `SO-2026-000001` for the first allocation in the
  current UTC year, never repeats a number, and correctly rolls over to
  `SO-2027-000001` (or the actual current+1 year) on a simulated year
  boundary while a `never`-reset type (e.g. `customer`) continues
  unbroken across the same boundary.
- Allocation under simulated concurrent/interrupted calls never
  produces a duplicate number.
- `allocateNext` on an unsupported document type key throws rather than
  silently allocating.
- Editing a `numbering_rules` prefix does not alter
  `current_sequence_value`.
- No `company` or `numbering_rules` row exists in the database
  immediately after this slice's migration runs on a fresh install (the
  tables exist; they are empty).
- No preload/IPC surface is added.

---

### Slice 6 — Tax Configuration

**Objective.** Support VAT-registered and non-VAT-registered operation
without hard-coding any rate, matching the already-confirmed default
(Farmer Ben's starts not VAT-registered, no seeded rates).

**Tables introduced.**

- `tax_codes` — stable code, name, category (`standard` / `zero_rated` /
  `exempt` / `other`), active flag.
- `tax_rate_versions` — `tax_code_id`, rate (parts-per-million integer,
  not a float), `effective_from`, `effective_to` (nullable).
  Non-overlapping date ranges per code enforced at the service layer.

**Services introduced.** `taxCodeService` (CRUD, Owner/Finance only),
`taxRateResolutionService` (given a code and a transaction date, returns
the rate in effect — the function every later invoice/PO line will
call). Historical resolution must be stable: changing today's rate must
never change a transaction dated last month.

**UI introduced.** None — configuration screen ships later alongside
company settings; this slice is schema + resolution logic + tests.

**Dependencies.** Slice 5 (`company.vat_registered` flag).

**Explicit exclusions.** No tax codes are seeded. Actual tax lines on
invoices/POs are Slices 18/23's job, using this resolution service. Tax
configuration remains a separate slice from Company Profile, as
instructed.

**Acceptance criteria.**

- Zero tax codes exist after a fresh install (VAT stays fully optional).
- `taxRateResolutionService` returns the correct historical rate for a
  past date even after a newer rate version has been added.
- Exempt/zero-rated codes work without requiring a numeric rate.
- Two overlapping effective-date ranges on the same code are rejected.

---

### Slice 7 — Authentication Foundations

**Objective.** Password hashing, session lifecycle, and the recovery-key
ceremony mechanics — service layer only, no screens yet. Mirrors the
already-confirmed design: Argon2id, in-memory sessions (no `session`
table), confirmation-before-commit recovery ceremony, no lockout timing
that reveals whether a username exists.

**Tables introduced.**

- `users` — `company_id`, login identifier (normalized, unique per
  company), password hash, `password_changed_at`, active flag,
  `failed_login_count`, `locked_until`.
- `roles` — fixed seed set: `owner`, `executive`, `operations`,
  `finance`.
- `user_roles` — join table.
- `owner_recovery_credentials` — recovery-key hash, version, timestamps,
  active flag (partial-unique: one active row per user).
- `login_events` — user (nullable), timestamp, success flag, source
  (`normal_login` / `session_unlock` / `owner_recovery`). No IP, no
  device identifier, no unmatched login identifier stored.

**Services introduced.** `passwordHashingService`, session manager
(in-memory), central `authorizationService` (`can(user, action)`, not
per-screen), recovery-ceremony service (generate → display once →
confirm → commit, all inside one transaction).

**UI introduced.** None. This slice proves the mechanics with tests
using fakes/real Argon2id hashing against disposable databases — the
same pattern already used for the DB bootstrap tests.

**Dependencies.** Slice 5 (`company_id` scoping), Slice 3 (DB
infrastructure).

**Explicit exclusions.** No login screen, no setup wizard (Slice 8), no
password-reset UI. No IPC exposure of any of this to the renderer yet.

**Acceptance criteria.**

- A password hash never appears in a log line, an audit row, or any
  object handed toward the renderer.
- Failed-login timing and messaging are statistically indistinguishable
  between a real and a nonexistent login identifier.
- The recovery-ceremony commit is all-or-nothing: a simulated crash
  between "old key revoked" and "new key generated" is impossible by
  construction (single transaction), verified by test.

---

### Slice 8 — First-Run Setup Wizard & Owner Recovery

**Objective.** The user-facing first-run flow: company details →
currency confirmation → Owner account creation → one-time recovery-key
display and confirmation → completion. **This is where the real
`company` row and the real `numbering_rules` rows (per Slice 5's
approved defaults) are actually inserted.**

**Tables introduced.** None — uses Slices 5–7's tables.

**Services introduced.** `firstRunSetupService` orchestrating the atomic
setup transaction: `company` row (`id = 'primary_company'`) + the 10
approved `numbering_rules` rows + Owner `user` + Owner `role` + recovery
credential + `application_state` marker, all in one transaction.

**UI introduced.** Setup wizard screens (multi-step), recovery-key
display/confirmation screen, completion screen. First real renderer
screens beyond the Slice 1 placeholder.

**Dependencies.** Slices 5, 6 (optional at this point), 7.

**Explicit exclusions.** Multi-company setup, email-based recovery, any
"skip setup" shortcut.

**Acceptance criteria.**

- Setup cannot complete until the person explicitly confirms the
  recovery key was saved.
- Killing the app mid-wizard leaves no partial company/numbering-rules/
  user/credential row; relaunching restarts the wizard cleanly.
- The recovery key is displayed exactly once and cannot be retrieved
  again through the UI afterward.
- On successful completion, all 10 approved numbering-rule rows exist
  with `current_sequence_value = 0` and the correct prefix/padding/reset
  behavior from Slice 5's table.

---

### Slice 9 — Users, Roles & Login

**Objective.** Ordinary login/logout/lock flow for the Owner and any
additional users the Owner creates, plus a minimal user-management
screen.

**Tables introduced.** None — uses Slice 7's tables.

**Services introduced.** `loginService` (wraps Slice 7's primitives),
user-management service (create/deactivate additional users, assign
roles — Owner only).

**UI introduced.** Login screen, session-lock screen, Users & Roles
settings screen.

**Dependencies.** Slices 7, 8.

**Explicit exclusions.** Fine-grained (per-field) permissions — roles
stay coarse-grained per the already-confirmed decision. No SSO.

**Acceptance criteria.**

- A deactivated user cannot log in even with the correct password.
- Idle timeout locks the session; correct-password re-entry resumes it
  without a full re-login.
- A non-Owner cannot reach the Users & Roles screen, enforced in the
  main process regardless of what the renderer shows.

---

### Slice 10 — Audit Logging Foundation

**Objective.** The shared audit-write path every later mutating service
will call, established once real mutations (Slices 5–9) exist to audit.

**Tables introduced.**

- `audit_log_entries` — entity type/id, entity label, action, changed
  fields (old→new, redacted), actor type (`user`/`system`), user_id
  (nullable), company_id (nullable), timestamp.

**Services introduced.** `auditService.record(...)` — field-level
diffing, fixed redaction list (never logs secrets), append-only.

**UI introduced.** A basic audit log viewer (filterable list),
Owner/Executive/Finance read access per the existing role table.

**Dependencies.** Slices 7, 9 (to have real actors to attribute entries
to). Retrofits onto Slices 6 (tax code edits), 8 (company/numbering
creation), 9 (user/role changes).

**Explicit exclusions.** No approval workflows yet (Slice 30). No
retention/archival policy beyond "keep everything" for now.

**Acceptance criteria.**

- Every mutation added in Slices 6, 8, and 9 produces exactly one
  matching audit row.
- A deliberately-injected secret-like field name is proven never to
  reach an audit row.
- Audit rows cannot be updated or deleted through any exposed service.

---

## Tier B — Master data (non-financial, before accounting)

### Slice 11 — Products & Variants

**Objective.** The product catalog: manufactured goods (with variants
like 100 ml / 200 ml / 2 L) and services (no stock, no recipe),
independent of any specific manufacturer's product line.

**Tables introduced.**

- `products` — `company_id`, code, name, type (`manufactured` /
  `service`), active flag.
- `product_variants` — `product_id`, code, name, selling price (integer
  minor units + currency), barcode (nullable), minimum finished-stock
  level, active flag.

**Services introduced.** `productService`, `productVariantService` —
validation (unique codes per company, non-negative prices).

**UI introduced.** Product & variant list/detail screens (Operations/
Executive edit access).

**Dependencies.** Slices 5 (`company_id`), 6 (variant prices may
reference a tax code — nullable link, not required).

**Explicit exclusions.** Recipes (Slice 19), inventory linkage (a
manufactured variant doesn't yet know what it consumes), sales pricing
history/discounts. No accounting posting — this is non-financial master
data.

**Acceptance criteria.**

- A service-type product can be created with no variant requiring stock
  fields.
- Duplicate variant codes within the same product are rejected.
- Deactivating a product does not delete history (no history exists yet
  at this slice — this becomes testable once Slices 18/21/23 exist, and
  is re-verified then).

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Product code.** `products.code` is automatically allocated using
   the existing, previously-unused `product` numbering rule (seeded by
   Slice 8), inside the same transaction as product creation. Never
   accepted from the renderer or IPC input. Immutable after creation.
   `product_variants.code` is user-entered and unique within its parent
   product (not company-wide).
2. **Currency.** `product_variants.currency_id` is kept (the plan
   requires price plus currency) but always set internally to
   `FUNCTIONAL_CURRENCY_ID` for M1 — never exposed through IPC or UI as
   a choice. `sellingPriceMinor` is a non-negative integer.
3. **Shared visual tokens.** `src/renderer/src/audit/ui.ts` relocates to
   `src/renderer/src/shared/ui.ts`; `AuditLogScreen.tsx` imports update
   accordingly. Products screens use the same shared
   operational-minimalist tokens. Login, setup, Users & Roles, and the
   overall shell are explicitly not redesigned in this slice.
4. **Authorization architecture.** Product IPC handlers use
   `requireAuthorizedCaller` with fresh SQLite roles (Slice 10's
   pattern), not `userManagementService`'s older, Owner-only,
   internally-checked pattern. `productService`/`productVariantService`
   remain session-independent, accepting an explicit `AuditActor` —
   matching `taxCodeService`. Any cosmetic session flag is never trusted
   as the real authorization boundary.
5. **Permissions.** `owner`, `executive`, and `operations` all receive
   both `products.read` and `products.manage`; `finance` receives
   `products.read` only. Two new cosmetic session flags —
   `canViewProducts`, `canManageProducts` — gate renderer nav/UI
   visibility only, exactly like `canViewAuditLog`.
6. **Barcode.** Nullable; trimmed on input, with an empty string
   normalized to `null`. A partial unique index covers non-null values
   only; a duplicate non-null barcode is rejected cleanly.
7. **Product-type behavior.** A service product may have zero variants.
   Service variants never request stock fields in the UI and always
   store `minimumFinishedStockLevel = 0`; a direct attempt to set a
   nonzero value on a service variant is rejected at the service layer
   regardless of what the UI shows. Manufactured variants allow a
   non-negative minimum stock level, defaulting to 0.
8. **Deactivation.** Deactivating a product changes only that product's
   active flag — it never cascades to deactivate its variants, and
   never deletes anything. Deactivating a variant changes only that
   variant. Reactivation is always a separate, explicit action.
9. **Tax code.** Nullable on a variant. When assigned, it must
   reference an existing, primary-company, currently-active tax code.
   A later deactivation of that tax code must never destroy the
   variant's stored reference (the FK is never cleared or cascaded).
10. **Audit behavior.** Every product/variant create, update,
    deactivate, or reactivate writes exactly one matching audit row in
    the same transaction as the business mutation — no more, no fewer.
    Numbering-rule counter allocation itself receives no separate audit
    row (it is an implementation detail of the create, not a
    independently-audited entity). A failed or true no-op mutation
    (e.g. reactivating an already-active row) produces no audit row,
    matching `taxCodeService`'s established no-op-suppression rule.

---

### Slice 12 — Inventory Items

**Objective.** The catalog of everything purchased or consumed:
ingredients, packaging, consumables — item master data only, no
quantities yet.

**Tables introduced.**

- `inventory_items` — `company_id`, code, name, category, item type
  (`ingredient` / `packaging` / `consumable` / `other`), base unit
  (`unit_of_measure_id`), minimum stock, reorder quantity, maximum
  stock, lead time days, lot-tracked flag, expiry-tracked flag, active
  flag.

**Services introduced.** `inventoryItemService` — validation (unique
code per company, base unit must exist and be an approved category).

**UI introduced.** Inventory item list/detail screens.

**Dependencies.** Slices 4 (`units_of_measure`), 5.

**Explicit exclusions.** Lots, stock quantities, supplier links,
unit-conversion factors (Slice 15 and later). No accounting posting.

**Acceptance criteria.**

- An item's base unit must reference an existing, active unit of
  measure.
- ~150 items can be created and listed without a noticeable UI delay
  (sanity check against the stated MVP scale).

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Inventory-item code.** User-entered (no numbering rule added, per
   approved decision — unlike `products.code`), required, trimmed and
   normalized to uppercase, unique within the company, and immutable
   after creation. `UpdateInventoryItemInput` has no `code` field at
   all.
2. **Permissions.** `owner`, `executive`, and `operations` all receive
   both `inventory_items.read` and `inventory_items.manage`; `finance`
   receives `inventory_items.read` only — mirroring Products' own
   matrix exactly. Two new cosmetic session flags —
   `canViewInventoryItems`, `canManageInventoryItems` — gate renderer
   nav/UI visibility only; real enforcement remains
   `requireAuthorizedCaller`, resolved fresh from SQLite on every call.
3. **Category.** Required, trimmed free-text field. No category
   reference table or fixed enum was introduced.
4. **Quantities.** `minimumStock`, `reorderQuantity`, and
   `leadTimeDays` are required, non-negative integers (rejecting
   decimals, negative/plus signs, whitespace-only, `NaN`, `Infinity`,
   and unsafe integers). `maximumStock` is nullable; when supplied, it
   must be `>= minimumStock`. No other cross-field restriction was
   added. No floating-point quantity arithmetic anywhere — these are
   plain integer counts, not currency amounts.
5. **Unit of measure.** Required. A new assignment (at creation, or
   when an update changes the value) must reference an active unit;
   an update that leaves the value unchanged never re-validates it, so
   an existing reference survives a later deactivation of that unit
   and remains visible as historical/current context. Once changed away
   from an inactive unit, it cannot be selected again.
6. **Action names.** `inventory_items.read`, `inventory_items.manage`.
7. **Lead time.** Non-negative integer with no arbitrary upper limit
   beyond safe-integer validation.

---

### Slice 13 — Suppliers

**Objective.** Supplier master data and per-supplier price history for
inventory items, independent of any actual purchase transaction.

**Tables introduced.**

- `suppliers` — `company_id`, code, name, contact details, active flag.
- `supplier_item_prices` — `supplier_id`, `inventory_item_id`, price
  (integer minor units + currency), `effective_from`. Multiple suppliers
  may price the same item differently; changing a supplier's current
  price must never alter the cost of inventory already received (this
  becomes enforceable once Slice 15 exists — the constraint is designed
  in now, verified then).

**Services introduced.** `supplierService`, `supplierPriceService`.

**UI introduced.** Supplier list/detail screens, per-supplier price
history view.

**Dependencies.** Slices 5, 12.

**Explicit exclusions.** Purchase orders, goods receipts, supplier
payments/balances (Slice 18). No accounting posting.

**Acceptance criteria.**

- A supplier can have prices for multiple items, and an item can have
  prices from multiple suppliers.
- Recording a new supplier price does not modify any prior price row
  (append-only price history).

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Supplier code.** System-generated, using the existing frozen
   `supplier` numbering rule (already seeded, unused, at first-run since
   Slice 8) — unlike `inventory_items.code`. Allocated inside the same
   transaction as the supplier insert and its audit row. The renderer
   never submits a supplier code; it is immutable after creation.
2. **Permissions.** `owner`, `executive`, `operations`, **and
   `finance`** all receive both `suppliers.read` and `suppliers.manage`
   — a deliberate departure from Products'/Inventory Items' Finance-
   read-only pattern, since supplier and supplier-item pricing data is
   treated as financial master data Finance directly manages.
   `supplier_item_prices` reuses these same two actions; no separate
   action pair was introduced for pricing. Two new cosmetic session
   flags — `canViewSuppliers`, `canManageSuppliers` — gate renderer
   nav/UI visibility only; real enforcement remains
   `requireAuthorizedCaller`, resolved fresh from SQLite on every call.
3. **Supplier-item relationship.** No separate `supplier_items` table.
   A `supplier_item_prices` row is itself the evidence that a supplier
   supplies an item.
4. **Active-state rule.** Recording a _new_ supplier price requires
   both the supplier and the inventory item to be currently active.
   Existing historical price rows are never affected by either side's
   later deactivation, and continue displaying the deactivated
   supplier's/item's label correctly.
5. **Contact details.** Nullable, trimmed; a blank value normalizes to
   `null`.
6. **Effective dates.** Past, present, and future values are all
   accepted. "Current price" is precisely defined as the latest row
   with `effectiveFrom <= now`, ordered by `effectiveFrom` descending
   and `createdAt` descending as a deterministic tiebreaker. A
   future-dated row is a scheduled price and must never become current
   early.
7. **Price-row uniqueness.** A real database `unique(supplierId,
inventoryItemId, effectiveFrom)` constraint exists; a violation is
   mapped to a dedicated `duplicate_effective_price` error rather than
   a raw constraint message.
8. **Supplier item code.** An optional `supplierItemCode` field on
   `supplier_item_prices` — nullable, trimmed, blank-becomes-null,
   representing the supplier's own SKU/reference _at the time that
   specific price was recorded_. No uniqueness constraint; historical
   rows preserve whatever value existed at insertion time, since the
   table is append-only.
9. **Lead time.** Not added to suppliers or to `supplier_item_prices`.
   `leadTimeDays` remains solely on `inventory_items`, unchanged from
   Slice 12.
10. **Unit and currency.** Price is always per the inventory item's own
    base unit — no purchase packs, conversion factors, or
    supplier-specific units are introduced. `currencyId` exists as a
    column but is always assigned `FUNCTIONAL_CURRENCY_ID` server-side;
    the renderer cannot submit or choose a currency.
11. **Append-only pricing.** `supplier_item_prices` supports insert,
    list, and current-price lookup only — structurally, no update or
    delete function exists anywhere in the codebase for this table.
    Corrections are always recorded as new rows. Each price insertion
    writes exactly one audit row in the same transaction as the insert.

---

### Slice 14 — Customers

**Objective.** Customer master data and contacts, independent of any
order. Moved into the master-data tier in this revision (previously
positioned just before Sales) since it is non-financial master data of
the same kind as products, inventory items, and suppliers.

**Tables introduced.**

- `customers` — `company_id`, code, name, contact details, default
  payment terms, credit limit (nullable), active flag.
- `customer_contacts` — `customer_id`, name, role, phone/email.

**Services introduced.** `customerService`.

**UI introduced.** Customer list/detail screens.

**Dependencies.** Slice 5.

**Explicit exclusions.** Customer-specific pricing (documented as a
later refinement), outstanding-balance display (needs Slice 23). No
accounting posting.

**Acceptance criteria.**

- ~500 customers can be created and searched without a noticeable UI
  delay (sanity check against stated MVP scale).

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Customer code.** System-generated, using the existing frozen
   `customer` numbering rule (already seeded, unused, at first-run
   since Slice 8) — unlike `inventory_items.code`, mirroring
   `suppliers.code` exactly. Allocated inside the same transaction as
   the customer insert and its audit row. Immutable after creation.
2. **Credit limits vs. balances — the key scope decision.** Credit
   limits belong in customer master data; balances and credit
   enforcement do not. `creditLimitMinor` is stored and editable here
   as a nullable integer-minor-units field (`null` = no configured
   limit, not unlimited credit); this slice calculates no balance, no
   remaining credit, and enforces nothing against it.
   Outstanding-balance display and any credit-enforcement logic remain
   deferred to Slice 23.
3. **Permissions.** `owner`, `executive`, `operations`, and `finance`
   all receive both `customers.read` and `customers.manage`, mirroring
   Suppliers' own precedent. `customer_contacts` reuses these same two
   actions; no separate action pair was introduced for contacts. Two
   new cosmetic session flags — `canViewCustomers`,
   `canManageCustomers` — gate renderer nav/UI visibility only; real
   enforcement remains `requireAuthorizedCaller`, resolved fresh from
   SQLite on every call.
4. **Business vs. individual customers.** No `customerType` column or
   equivalent distinction was introduced; the same structure serves
   both, with `name` as the display name for either.
5. **Contact details.** Nullable, trimmed; a blank value normalizes to
   `null`.
6. **Payment terms.** A plain nullable integer (`paymentTermsDays`) —
   no payment-terms reference table was introduced, a new concept with
   no prior pattern to mirror. `null` means no default configured; `0`
   is a valid "due immediately" value, never treated as absent.
7. **Customer contacts.** A simple, non-append-only child list using
   soft activation only (deactivate/reactivate) — no hard delete,
   matching this codebase's established posture for every other
   business record. Mutations require the parent customer to be
   currently active; reads are never gated this way, so an inactive
   customer's contacts remain visible for historical reference.
   Deactivating a customer never cascades to its contacts. A contact's
   parent is fixed at creation and cannot be reassigned via update.
8. **Contact validation.** `role`, `phone`, and `email` are all
   optional with no format validation and no requirement that at least
   one be present — no established convention exists anywhere in this
   codebase for either.
9. **Currency.** `currencyId` exists as a column on `customers` but is
   always assigned `FUNCTIONAL_CURRENCY_ID` server-side; the renderer
   cannot submit or choose a currency.
10. **No tax field.** No customer tax-exemption flag, default tax code,
    or other tax-treatment field was introduced — none is named in the
    approved scope.
11. **Search.** `CustomerListScreen` implements client-side,
    case-insensitive search over code/name/contactDetails, required by
    the acceptance criterion that ~500 customers be searchable — a new
    UI pattern relative to Products/Inventory Items/Suppliers' own
    plain, unfiltered list screens.

---

### Slice 15 — Inventory Lots & Stock Ledger (FIFO)

**Objective.** The FIFO costing engine: lots, quantity states
(physical/reserved/available/incoming), and the consumption algorithm
every later purchase and production slice will call. This is
infrastructure/mechanism, not a financial transaction — it posts
nothing to the ledger on its own.

**Tables introduced.**

- `inventory_lots` — `inventory_item_id`, supplier reference (nullable),
  received date, quantity received, quantity remaining, unit cost
  (integer minor units), supplier lot number (nullable), internal lot
  number, expiry date (nullable), status (`active` / `quarantined` /
  `expired` / `depleted`).
- `stock_movements` — append-only ledger: `inventory_lot_id`, movement
  type (`receipt` / `consumption` / `adjustment` / `reservation` /
  `release`), quantity (signed), reference (polymorphic — which
  purchase/production/sale caused it), timestamp.

**Services introduced.** `fifoConsumptionService` — given an item and a
quantity, selects lots oldest-first, returns the exact lot/quantity
breakdown and its total cost; never mutates negative stock; rejects
expired/quarantined lots unless an authorized override is supplied.
`stockQuantityService` — physical/reserved/available/incoming
calculations.

**UI introduced.** Stock-on-hand view per item (read-only at this
slice), lot detail view.

**Dependencies.** Slice 12. Consumed by Slices 18 (receipts write lots),
21 (production reads/consumes lots), 22 (sales reserve finished-goods
"lots").

**Explicit exclusions.** Purchasing UI (Slice 18), production UI (Slice
21), unit-conversion factors between purchase and consumption units
(flagged as an open decision in §8 — this slice assumes item purchase
unit equals consumption unit unless that decision resolves otherwise
before this slice starts). No accounting posting — this slice creates
and moves lots; it does not, by itself, create a journal entry
(Purchasing and Production, which use this engine, do).

**Acceptance criteria.**

- The worked FIFO example already documented (20 kg @ $3.50 then 50 kg
  @ $4.20; a 30 kg consumption draws 20 kg from the first lot and 10 kg
  from the second) passes as an automated test, byte-exact on cost.
- Negative stock is impossible without an explicit, tested override
  path.
- Reserving stock reduces "available" without reducing "physical."

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Status model correction from the original plan.** The plan above
   lists `active`/`quarantined`/`expired`/`depleted` as the lot status
   values; as implemented, only three values are ever _persisted_
   (`active`/`quarantined`/`depleted`) — `expired` is instead _derived_
   at read time from `expiryDate` vs. the current moment, never stored,
   since whether a lot is expired right now is a function of the clock,
   not a fact to persist and let go stale. The read-model surfaces both
   `lifecycleStatus` (persisted) and `effectiveStatus` (persisted status,
   with `expired` folded in) for exactly this reason.
2. **Scaled-integer quantities.** `quantityScale = 10 ^
unitOfMeasure.decimalPlaces`; every physical quantity is an integer
   in that scale, never a float. Parsing a decimal string never
   multiplies a float by the scale — confirmed directly that ordinary
   IEEE 754 arithmetic does not round-trip exactly for many decimal
   fractions, so `quantityScale.ts` extracts whole/fractional digit
   strings via regex and concatenates them into a single integer
   instead.
3. **Numbering.** `internalLotNumber` uses a newly-approved
   `inventory_lot` numbering rule (`LOT`, never-reset, 6-digit padding),
   mirroring `customers.code`/`suppliers.code`'s own precedent exactly.
4. **Authorization — a new three-tier matrix.** `inventory_lots.read`,
   `inventory_lots.manage`, and `inventory_lots.override` as three
   separate actions (distinct from every prior domain's two-action
   read/manage pair), so a role can manage lots without being able to
   bypass the expired/quarantined consumption guard. Owner/Executive:
   all three. Operations: read/manage, explicitly **not** override.
   Finance: **read only** — unlike Suppliers/Customers, stock lots are
   physical-inventory mechanics, not financial master data Finance
   directly manages.
5. **Append-only, once-only reversal.** No update or delete path exists
   anywhere for `stock_movements`; corrections are new movements
   (adjustments or reversals), never edits. A movement can be reversed
   once only, enforced by both an explicit service-layer check and the
   database's own unique constraint on `reversed_movement_id`.
6. **Cost allocation — exact integer arithmetic.** A lot's full
   depletion consumes its entire `costRemainingMinor` exactly; a
   partial draw uses `round(costRemainingMinor * drawn /
remaining)` — one deliberate rounding step, confirmed by a dedicated
   test to conserve cost exactly across multiple unequal partial draws
   from the same lot, not only the trivial single-draw case.
7. **This slice's own IPC/renderer surface is read-only, end to end.**
   `createOpeningLot` and every mutation service
   (`recordAdjustment`/`reserveStock`/`releaseReservation`/
   `reverseMovement`/`consumeStock`/`setLotQuarantined`/`setLotActive`)
   are service-layer-only in this slice, callable in-process by later
   slices (Purchasing, Production, Sales) but exposed nowhere over IPC.
   `registerInventoryLotHandlers.ts` registers exactly 5 read channels.
8. **Renderer navigation is three screens deep**, not two as a naive
   reading of "stock-on-hand view + lot detail" might suggest: a stock
   summary row represents an item, potentially with several lots, so
   `StockOnHandScreen` → `InventoryItemLotsScreen` (every lot for that
   item, reader chooses) → `InventoryLotDetailScreen` — silently
   auto-selecting a single lot when more than one exists was
   considered and rejected as ambiguous.
9. **Reconciliation is independently verified, not merely asserted.**
   `stockLedgerReconciliation.test.ts` reconstructs every lot's cached
   `quantityRemainingScaled`/`costRemainingMinor` directly from raw
   `stock_movements` rows — never trusting `stockQuantityService`'s own
   derived output — and proves the cached columns exactly equal
   `SUM(physicalQuantityDeltaScaled)`/`SUM(costDeltaMinor)` across every
   scenario (opening, partial/full/multi-lot consumption, adjustment,
   reservation, release, reversal, and a combined 6-step lifecycle).

---

## Tier C — Accounting Foundations

**Everything in this tier must exist before Slice 18 (Purchasing) or any
later transactional slice can post a real financial event, per the
approved direction in this revision.**

### Slice 16 — Accounting Foundations: Chart of Accounts & General Ledger

**Objective.** Introduce proper double-entry bookkeeping structures,
building on the starter chart of accounts already designed (asset /
liability / equity / revenue / cost_of_goods_sold / expense categories,
with subtypes, immutable codes, lockable account type).

**Tables introduced.**

- `accounts` — `company_id`, immutable code, display name, category,
  subtype, `currency_id`, `parent_account_id` (nullable), type-locked
  flag, active flag. `currency_id` is expected to always resolve to the
  company's functional currency (USD) for the whole of M1 — see §6.
- `journal_entries` + `journal_entry_lines` (debit/credit, must balance)
  — manual entries restricted to authorized users (Owner/Finance).

**Services introduced.** `chartOfAccountsService`, `journalEntryService`
(enforces balanced entries, immutable once posted — corrections are
reversing entries, never edits).

**UI introduced.** Chart of accounts view, manual journal entry screen
(restricted access), trial balance view.

**Dependencies.** Slices 5, 9 (authorization), 10 (audit).

**Explicit exclusions.** Automatic posting from operational modules
(Slice 17 builds the reusable mechanism; each transactional slice from
Slice 18 onward wires its own rules into it). Multi-currency ledger
entries — every entry posts in USD; see §6.

**Acceptance criteria.**

- Every journal entry balances (total debits = total credits) or is
  rejected.
- A posted journal entry cannot be edited; a correction requires a new
  reversing entry, and both remain visible in history.
- The starter chart of accounts seeds correctly and matches the
  previously confirmed account list (Cash on Hand, Primary Bank, Mobile
  Money, Petty Cash, Undeposited Funds, Receivables, Payables).
- Every seeded account's `currency_id` resolves to USD.

**Decisions approved for this slice (owner review, following the
pre-implementation plan above).**

1. **Schema corrections from the original plan.** The plan above lists
   `parent_account_id` (nullable) and a separate "type-locked flag" on
   `accounts`; as implemented, neither exists — `category` itself is
   simply immutable once an account is created (enforced by
   `chartOfAccountsService.ts`'s own `UpdateAccountInput` never
   accepting a `category` field at all, a compile-time guarantee, not
   just a runtime check), which supersedes the need for a separate
   lock flag. Account hierarchy (`parent_account_id`) remains
   genuinely deferred — no column, no behavior — rather than added now
   and left unused. `accounts` also carries no `currency_id` column at
   all: currency is a property of a _posted transaction_
   (`journal_entries.currency_id`), not of the account it touches,
   since this slice's own approved scope has multi-currency ledger
   entries excluded entirely (§6).
2. **Account codes are caller-supplied, not numbering-rule-generated.**
   A departure from every prior master-data entity in this codebase
   (customers/suppliers/products/inventory lots all use the
   system-generated numbering-rule mechanism) — approved decision: a
   small, deliberately-curated chart of accounts doesn't benefit from
   an auto-incrementing sequence the way high-volume records do, and
   conventional accounting codes (1000 = cash, 2000 = liabilities)
   carry meaning a numbering rule would obscure. Codes are 4–10 ASCII
   digits, immutable once created.
3. **Created posted immediately — no draft state.** No `status` column
   exists anywhere in `journal_entries`; there is no draft-creation or
   approval API. This matches the plan's own "manual journal entry
   screen (restricted access)" wording exactly, with no draft workflow
   ever implied.
4. **Reversal, not edit, is the only correction mechanism** — mirroring
   `stock_movements`' own append-only/reversal-once-only precedent from
   Slice 15 exactly. A reversal entry can never itself be reversed,
   checked explicitly. Reversal does not require every referenced
   account to currently be active (undoing a past action must work even
   after later, unrelated deactivation), while a brand-new manual
   posting does require every referenced account to be active.
5. **Starter chart seeded idempotently, at zero balance, with no
   opening-balance journal.** `ensureStarterChartOfAccounts` only ever
   inserts a starter code that doesn't already exist, runs from both
   first-run setup (new companies) and an upgrade-detection path
   (existing companies), and never creates any journal entry while
   seeding — an account existing with a zero cached balance is not
   itself a financial fact requiring a journal entry. Opening balances,
   if and when a company needs to record them, are ordinary manual
   journal entries created afterward, exactly like any other entry —
   there is no dedicated opening-balance mechanism.
6. **Authorization — the first domain where Executive does not mirror
   Owner.** `accounts.read`/`accounts.manage`/`journal_entries.read`/
   `journal_entries.manage` as four separate actions. Owner and Finance
   receive all four (Finance _is_ the accounting-authoritative role
   here, unlike its read-only posture on Suppliers/Customers/Stock).
   Executive receives the two `.read` actions only — a deliberate
   departure from every prior domain, where Executive has always had
   full parity with Owner. Operations receives none of the four — the
   first domain Operations is excluded from entirely.
7. **Trial balance is all-time only, reconstructed on every call.** No
   cached balance column exists anywhere for this purpose; no date
   range, no accounting-period parameter, and no period-locking concept
   exist anywhere in this slice — accounting periods are explicitly
   deferred to a later slice, not addressed here at all.
8. **`SafeJournalEntry` gained a narrow, server-computed
   `hasBeenReversed` field**, added specifically because the renderer
   must never infer "has this entry already been reversed" client-side
   from a partial view of the data — `JournalEntryDetailScreen`'s own
   reversal-visibility logic depends on this field being computed
   server-side, not guessed.

---

### Slice 17 — Accounting Posting Framework

**Objective.** Build the reusable, generic mechanism that lets any
future operational service post a balanced journal entry as part of its
own database transaction — proven here in isolation, before any real
operational module (Purchasing, Production, Sales, Expenses, Payroll)
exists to consume it.

**Tables introduced.** None — uses Slice 16's tables.

**Services introduced.** `postingService` — a single reusable primitive
(e.g. `postBalancedEntry(tx, { lines, reference, description })`) that:

- validates the given lines balance before writing anything;
- writes the journal entry and its lines inside the **caller's own
  transaction** (never a separate transaction, never "fire and forget"
  after the caller's transaction commits);
- throws (causing the caller's whole transaction to roll back) if the
  entry would not balance or if any referenced account doesn't exist or
  is inactive.

This slice's own tests exercise `postingService` against synthetic
example transactions (not real purchases or sales, since those don't
exist yet) to prove the mechanism is correct and atomic before Slice 18
becomes its first real caller.

**UI introduced.** None.

**Dependencies.** Slice 16.

**Explicit exclusions.** Any domain-specific posting rule (what account
a goods receipt debits, what a payslip credits, etc.) — those belong to
each later transactional slice, per the approved direction that each
slice owns and tests its own posting rules rather than relying on a
future bulk-wiring pass. No backfill/bulk-posting tool of any kind is
planned in this roadmap.

**Acceptance criteria.**

- `postingService` rejects an unbalanced set of lines without writing
  anything.
- A simulated failure partway through a caller's transaction (after
  `postingService` was invoked but before the caller's transaction
  commits) leaves neither the operational data nor the journal entry
  persisted — true all-or-nothing behavior, verified by test.
- Referencing an inactive or nonexistent account is rejected.

---

## Tier D — Purchasing

### Slice 18 — Purchasing: Orders, Direct Purchases, Goods Receipts & Posting

**Objective.** The full purchase-to-receipt flow, respecting the
already-confirmed rule set (a PO does not move inventory; a supplier
invoice does not move inventory; only a goods receipt does; partial
deliveries stay open) — and, new in this revision, posts its own
accounting entries as part of the same slice, using Slice 17's
framework.

**Tables introduced.**

- `purchase_orders` + `purchase_order_lines`.
- `goods_receipts` + `goods_receipt_lines` (creates `inventory_lots`
  rows via Slice 15's service).
- `direct_purchases` (a receipt with no prior PO).
- `supplier_invoices` (financial record only — no inventory effect).

**Services introduced.** `purchaseOrderService` (draft-like — creating
or editing a PO does not post anything, matching "draft/non-posted
records may exist without journal entries"), `goodsReceiptService` (the
transaction-creating event — calls Slice 15's lot-creation path _and_
Slice 17's `postingService` inside the same database transaction:
inventory asset increases, accounts payable increases), `directPurchaseService`
(same posting treatment as a receipt, since it has the same inventory
effect).

**UI introduced.** PO creation/list, goods-receipt recording screen,
direct-purchase screen, open-PO tracking (partial delivery status).

**Dependencies.** Slices 5 (numbering), 6 (tax lines on POs/invoices),
12, 13, 15, 16, 17.

**Explicit exclusions.** Supplier payments and running balances
(deferred — needs Slice 23's payment concept to be meaningful; tracked
as a payable amount only until then), landed-cost allocation across
multiple items on one receipt (documented gap, candidate for a later
refinement slice), returns to suppliers (Slice 29).

**Acceptance criteria.**

- A PO with 100 units ordered and 60 received twice (partial, then
  final) ends with the correct remaining-open quantity at each step and
  zero inventory effect from the PO itself, and zero journal entries
  from the PO alone.
- A goods receipt creates exactly the lot(s) matching Slice 15's schema
  and unit cost, **and** exactly one balanced journal entry in the same
  database transaction — a simulated posting failure rolls back the
  entire receipt, leaving no lot created and no partial journal entry.
- Changing a supplier's current price does not alter the unit cost of a
  previously received lot.

---

## Tier E — Recipes & Production

### Slice 19 — Recipes / Bills of Material

**Objective.** Versioned recipes per product variant; a new recipe
version never alters a historical batch's recorded recipe.

**Tables introduced.**

- `recipe_versions` — `product_variant_id`, version number, status
  (`draft` / `active` / `retired`), expected yield, expected waste,
  expected finished quantity, effective date, notes.
- `recipe_ingredients` — `recipe_version_id`, `inventory_item_id`,
  required quantity, unit.

**Services introduced.** `recipeService` — creating a new version never
edits a prior one; only one version may be `active` per variant at a
time.

**UI introduced.** Recipe editor (ingredient list, expected
yield/waste), recipe version history view.

**Dependencies.** Slices 11, 12.

**Explicit exclusions.** Unit-conversion between recipe units and
inventory base units beyond the same-unit assumption noted in Slice 15
(same open decision applies here). Production itself (Slice 21). No
accounting posting — a recipe is a formula, not a transaction.

**Acceptance criteria.**

- Editing an active recipe creates a new version rather than mutating
  the existing row; the prior version remains readable in full.
- A recipe requires at least one ingredient before it can become
  `active`.

---

### Slice 20 — Production Planning & Next Production Assistant

**Objective.** Recommend what to produce next and preview its cost,
without ever starting production automatically. Includes overhead-rate
configuration, since the cost preview needs it.

**Tables introduced.**

- `overhead_rate_versions` — scope (`global` / product-specific), basis
  unit, rate (integer minor units per basis unit), effective date.
  (`overhead_rate_definitions` as the stable identity row, mirroring
  the tax-code pattern from Slice 6.)
- `production_plans` — recommended/requested product variant, quantity,
  priority (`critical` / `high` / `medium` / `optional`), readiness
  status, reasoning snapshot (why it's/isn't ready).

**Services introduced.** `nextProductionAssistantService` (reads
confirmed/overdue orders once Slice 22 exists — degrades gracefully to
stock-level-only recommendations until then), `productionCostPreviewService`
(materials at current FIFO cost + packaging + overhead rate + directly
assigned expected expenses).

**UI introduced.** Next Production Assistant dashboard panel, cost
preview screen for a proposed run.

**Dependencies.** Slices 15, 19. Partially depends on Slice 22 (sales
orders) for full recommendation quality — designed to work without it,
improves once it exists.

**Explicit exclusions.** Actual production recording (Slice 21).
Production-hour-based overhead (documented as a post-M1 addition per
the original allocation-method decision). No accounting posting — this
slice previews and recommends; it records nothing permanent.

**Acceptance criteria.**

- A plan's readiness status correctly reflects one of the previously
  agreed states (Ready / Ready but Cash Is Tight / Waiting for
  Ingredients / Waiting for Packaging / Recipe Incomplete / Insufficient
  Information / Not Economically Advisable), with a plain-language
  reason.
- The cost preview uses live FIFO costs for on-hand materials and the
  current overhead rate; changing the overhead rate does not alter a
  previously generated preview snapshot.

---

### Slice 21 — Production Batches & Posting

**Objective.** Record actual production: consume inventory via FIFO,
create finished goods, calculate real cost per unit, keep the batch as a
permanent historical record, and — new in this revision — post the
corresponding accounting entry as part of the same slice.

**Tables introduced.**

- `production_batches` — `recipe_version_id`, planned/actual quantity,
  batch number (via `numberingService`), manufacturing date, expiry
  date (nullable), operator, notes, total cost, cost per unit.
- `production_batch_consumptions` — which lots were consumed, exact
  quantities (the FIFO breakdown, permanently recorded even if the
  recipe or FIFO order would differ if recalculated today).
- `production_batch_expenses` — directly assigned batch costs (fuel,
  labour, etc.) referencing `expense_categories` (Slice 4).

**Services introduced.** `productionBatchService` — orchestrates Slice
15's `fifoConsumptionService` consumption, creates a new
`inventory_lots` row for the finished-goods variant, computes final
cost using actual quantities and the overhead rate in effect at batch
date, and calls Slice 17's `postingService` inside the same transaction
(raw-material/packaging asset value moves into finished-goods asset
value; any directly assigned overhead/expense posts too).

**UI introduced.** Batch recording screen, batch history/detail view.

**Dependencies.** Slices 15, 17, 19, 20.

**Explicit exclusions.** Batch reversal/correction UI (the underlying
principle — corrections are new adjustment transactions, never edits —
is enforced at the service layer now; a dedicated correction screen can
follow later without a schema change).

**Acceptance criteria.**

- A completed batch's recorded recipe version, consumed lots, and cost
  never change even if the live recipe or inventory costs change
  afterward.
- Total cost reconciles exactly: materials + packaging + direct
  expenses + (overhead rate × actual output) = recorded total cost, no
  rounding drift (largest-remainder allocation where a split is
  needed).
- The finished-goods lot created matches the batch's actual output
  quantity.
- Completing a batch produces exactly one balanced journal entry in the
  same transaction; a simulated posting failure rolls back the entire
  batch (no lot consumption, no finished-goods lot, no partial journal
  entry).

---

## Tier F — Sales

### Slice 22 — Sales: Quotations & Sales Orders

**Objective.** Quotation-to-confirmed-order flow, with stock reservation
on confirmation — reservation logic lives here, not as a separate slice.
Confirming an order reserves stock but posts nothing to the ledger (see
§5); accounting already exists by this point regardless.

**Tables introduced.**

- `quotations` + `quotation_lines`.
- `sales_orders` + `sales_order_lines` (status: draft / confirmed /
  partially fulfilled / fulfilled / cancelled).

**Services introduced.** `quotationService`, `salesOrderService` —
confirming an order reserves finished-goods stock via Slice 15's
quantity states; does not reduce physical stock; does not post.

**UI introduced.** Quotation and sales-order creation/list screens,
quotation → order conversion action.

**Dependencies.** Slices 11, 14, 15. Feeds Slice 20's recommendation
quality once live.

**Explicit exclusions.** Invoicing, delivery, payment, and their
accounting postings (Slice 23).

**Acceptance criteria.**

- Confirming a sales order reduces "available" finished-goods stock
  without reducing "physical" stock, and creates zero journal entries.
- Partial fulfilment leaves the correct remaining-open quantity on the
  order.

---

### Slice 23 — Sales: Invoices, Deliveries, Payments & Posting

**Objective.** Convert confirmed orders into invoices, record
deliveries, and record payments (cash and credit), tracking outstanding
and overdue balances — and post the corresponding accounting entries as
part of this slice.

**Tables introduced.**

- `invoices` + `invoice_lines` (references `tax_codes` per line).
- `deliveries` + `delivery_lines` (reduces physical finished-goods
  stock).
- `payments` — `payment_method_id` (Slice 4), amount, date, applied
  invoice(s).

**Services introduced.** `invoiceService` (posts revenue/receivable/tax
liability on issue), `deliveryService` (posts cost-of-goods-sold moving
out of finished-goods asset value), `paymentService` (posts
cash/bank/mobile-money against the receivable) — all via Slice 17's
`postingService`, each inside its own operation's transaction.
Outstanding/overdue balance calculations.

**UI introduced.** Invoice creation/list, delivery recording, payment
recording, customer statement view.

**Dependencies.** Slices 6, 15, 14, 16, 17, 22.

**Explicit exclusions.** Credit notes (Slice 29).

**Acceptance criteria.**

- A delivery reduces physical finished-goods stock by exactly the
  delivered quantity, drawn FIFO from finished-goods lots, and posts a
  balanced journal entry in the same transaction.
- An invoice posts a balanced journal entry (receivable, revenue, tax
  liability where applicable) in the same transaction it is issued in.
- A partial payment posts correctly, leaves the correct outstanding
  balance, and an overdue invoice is correctly flagged based on its due
  date.
- Any posting failure in any of the three services rolls back that
  operation entirely — no invoice/delivery/payment is left recorded
  without its journal entry.

---

## Tier G — Expenses & Reporting

### Slice 24 — Expenses & Posting

**Objective.** Record business expenses not captured as ingredients,
packaging, or direct batch costs, classified per the existing category
list (Slice 4) and expense-nature list (direct manufacturing / indirect
overhead / selling / admin / finance / capital / owner drawing / other)
— and post the corresponding accounting entry as part of this slice.

**Tables introduced.**

- `expenses` — `expense_category_id`, nature classification, amount,
  currency, `payment_method_id`, date, description, receipt reference
  (nullable), approved-by (nullable, for Slice 30).

**Services introduced.** `expenseService` — posts via Slice 17's
`postingService` in the same transaction as recording the expense
(expense account debited, cash/bank/payable credited depending on
payment method).

**UI introduced.** Expense entry/list screen.

**Dependencies.** Slices 4, 5, 6, 16, 17.

**Explicit exclusions.** None beyond what's listed above — this is
deliberately one of the smaller transactional slices.

**Acceptance criteria.**

- Every expense has exactly one category and one nature classification.
- Recording an expense posts exactly one balanced journal entry in the
  same transaction; a simulated posting failure rolls back the expense
  record entirely.
- Expenses correctly feed Slice 21's "directly assigned batch expense"
  concept when tagged to a specific batch (nullable batch reference).

---

### Slice 25 — Accounting: Core Financial Reports

**Objective.** Profit & Loss, Balance Sheet, Trial Balance, and basic
Cash Flow, generated from the general ledger.

**Tables introduced.** None — read-only reporting over Slices 16–24's
data.

**Services introduced.** `reportingService` (P&L, balance sheet, trial
balance, cash flow — for a selected date range). All figures are in
USD, per §6.

**UI introduced.** Report screens (selectable date range, export/print
as a later refinement).

**Dependencies.** Slices 16, 17, 18, 21, 23, 24.

**Explicit exclusions.** Multi-period comparison views,
budget-vs-actual (candidates for a later milestone).

**Acceptance criteria.**

- The trial balance always balances by construction (sum of all account
  balances nets to zero).
- P&L and balance sheet figures reconcile against a manually constructed
  test scenario spanning a purchase, a production batch, a sale, and an
  expense.

---

## Tier H — Payroll, Dashboard, Alerts

### Slice 26 — Payroll Foundations & Posting

**Objective.** Minimal payroll: employees, salaries, and payslips, with
statutory deductions modeled as fully configurable data — never
hard-coded Zimbabwean rates, since these change — posting to the ledger
as part of this slice.

**Tables introduced.**

- `employees` — `company_id`, name, role/position, start date, active
  flag.
- `salary_components` — `employee_id`, component type (`basic` /
  `allowance` / `deduction`), amount or formula reference, effective
  date.
- `statutory_deduction_rules` — configurable name, calculation basis,
  rate/table (versioned, same effective-dating pattern as tax codes).
- `payslips` + `payslip_lines` — one per employee per pay period,
  immutable once issued (corrections are new adjustment payslips).

**Services introduced.** `payrollService` — computes a payslip from
current salary components and statutory rules in effect on the pay
date; posts a balanced journal entry (salary expense, statutory
liability accounts, net pay) via Slice 17's `postingService` in the
same transaction as issuing the payslip.

**UI introduced.** Employee list, salary setup, payslip generation and
view.

**Dependencies.** Slices 9, 16, 17.

**Explicit exclusions.** Loans/advances against salary, leave tracking,
tax-authority filing/submission integrations (all documented as
post-M1).

**Acceptance criteria.**

- Changing a statutory rate today does not alter a previously issued
  payslip's figures.
- Issuing a payslip posts a balanced journal entry in the same
  transaction; a simulated posting failure rolls back the entire
  payslip.

---

### Slice 27 — Business Health Dashboard

**Objective.** The at-a-glance dashboard combining money, inventory,
production, sales, and profit — read-only, drawing on every module
built so far.

**Tables introduced.** None.

**Services introduced.** `businessHealthService` — aggregates existing
services (no duplicated business logic; this slice is composition, not
new calculation rules).

**UI introduced.** The Business Health dashboard screen.

**Dependencies.** Slices 15, 20, 22, 23, 24, 25 (the more of these that
exist, the more complete the dashboard — designed to degrade gracefully
if run against a partial dataset, same principle as Slice 20).

**Explicit exclusions.** Alerts (Slice 28 — the dashboard displays
current state; alerts are a separate notify-when-something-crosses-a-
threshold concern).

**Acceptance criteria.**

- Every figure shown on the dashboard is traceable to a specific
  existing service call — no dashboard-only calculation logic
  introduced.
- Best-selling and most-profitable product lists are computed and
  displayed separately, as previously specified.

---

### Slice 28 — Business Alerts

**Objective.** A focused, prioritized alert list (not the full
brainstormed catalogue) — reorder points, expiring stock, overdue
invoices, insufficient cash for planned production, margin below cost.

**Tables introduced.**

- `alert_rules` (which alert types are enabled — configurable, not all
  hard-on) — optional; may instead ship as fixed logic with a simple
  on/off toggle per type if a full rules table proves unnecessary at
  this scale (a build-time decision, not a business one).

**Services introduced.** `alertService` — evaluates the current state
against existing services (again, composition over new logic).

**UI introduced.** Alert list/badge in the dashboard.

**Dependencies.** Slice 27.

**Explicit exclusions.** Push notifications, email/SMS delivery (out of
scope for an offline desktop app in M1).

**Acceptance criteria.**

- A starter set of alerts (stock below reorder level, invoice overdue,
  selling price below production cost) fires correctly against a known
  test scenario and does not fire when the condition isn't met.

---

## Tier I — Hardening

### Slice 29 — Returns & Credit Notes (Supplier and Customer) & Posting

**Objective.** Handle the return paths deliberately excluded from
Slices 18 and 23: returns to suppliers (damaged/rejected goods) and
customer returns/credit notes — posting to the ledger as part of this
slice.

**Tables introduced.**

- `supplier_returns` + lines (reverses the relevant lot quantity,
  reduces a payable).
- `customer_credit_notes` + lines (reduces a receivable, may restock or
  write off the returned item).

**Services introduced.** `supplierReturnService`, `creditNoteService` —
both post accounting entries via Slice 17's `postingService` in the
same transaction as recording the return/credit note.

**UI introduced.** Return/credit-note recording screens on both sides.

**Dependencies.** Slices 16, 17, 18, 23.

**Explicit exclusions.** Restocking a returned item to a _new_ lot with
its own cost is the assumed default; the alternative (crediting back
into the original lot) is flagged in §8 as a decision worth confirming
before this slice starts.

**Acceptance criteria.**

- A supplier return correctly reduces the relevant payable, posts a
  balanced journal entry, and does not silently re-inflate stock it
  shouldn't.
- A customer credit note correctly reduces the customer's outstanding
  balance and posts the matching accounting entry.
- Either posting failure rolls back its entire operation.

---

### Slice 30 — Sensitive-Action Approvals & Roles Hardening

**Objective.** Add the approval gate for the specific sensitive actions
already identified (large purchase orders, inventory write-offs,
expired-stock overrides, manual journal entries, price changes above a
configured percentage) — a hardening pass now that there is real
functionality to gate, not a redesign of the coarse-grained role model
from Slice 9.

**Tables introduced.**

- `approval_requests` — entity type/id, requested action, requested by,
  approved/rejected by (nullable), status, reason.

**Services introduced.** `approvalService`, integrated into the relevant
existing services from Slices 6 (price changes), 12/15 (write-offs,
expired-stock overrides), 18 (large POs), 16 (manual journal entries).

**UI introduced.** Pending-approvals screen (Owner view), inline
approval prompts where a gated action is attempted.

**Dependencies.** Slices 9, 10, and whichever operational slices each
specific gate applies to.

**Explicit exclusions.** Multi-level approval chains — a single
Owner-approves model only, matching the coarse-grained role philosophy
already established.

**Acceptance criteria.**

- Each of the five identified sensitive actions is provably blocked
  without approval and provably allowed once approved, for a
  non-Owner-initiated request.
- An Owner's own actions do not require self-approval (documented
  behavior, not a bug).

---

## Tier J — Final

### Slice 31 — Packaging, Backup, Restore & Windows Compatibility

**Objective.** Everything needed to actually ship LedgerPage: a packaged
installer, a trustworthy backup/restore story, and confirmed Windows
compatibility — deliberately last, once the schema has settled.

**Tables introduced.**

- `backup_records` — trigger type, file path, size, integrity-check
  result, schema version, success/failure, timestamp (matching the
  already-designed shape from the earlier architecture notes).

**Services introduced.** `backupService` (manual + scheduled, using
SQLite's backup API with the four-stage success verification already
specified: completes / opens / integrity-check passes / metadata
readable), `restoreService` (documented and tested manual procedure at
minimum; a guided in-app restore UI if time permits).

**UI introduced.** Backup settings screen (schedule, manual "Back Up
Now", backup history), restore flow.

**Dependencies.** Every prior slice (this is the packaging pass over the
whole application).

**Explicit exclusions.** Cloud backup destinations, multi-device sync —
both explicitly out of scope for this roadmap.

**Acceptance criteria.**

- A full install-to-first-run walkthrough succeeds on a clean Windows
  machine, not just macOS/Linux dev environments.
- A backup taken mid-use, restored onto a fresh install, reproduces the
  exact data state at backup time, verified end-to-end.
- Native module packaging (the `better-sqlite3` Electron-ABI rebuild
  already required for `dev`/`preview`) is proven to work inside the
  actual packaged installer, not just the dev workflow.

---

## §6. Currency behavior (clarified in this revision)

- The company's functional currency remains **USD**.
- `ZWG`, `ZAR`, `BWP`, and `CNY` remain **reference data only** (Slice
  4). Their presence in the `currencies` table does not imply that
  foreign-currency purchasing, sales, or any other transaction posting
  is implemented in M1.
- Full multi-currency **transaction posting** is outside this roadmap
  unless separately approved as its own milestone. If it is approved
  later, it affects at minimum Slices 16 (accounts would need to carry
  a currency independent of the posting currency), 17 (the posting
  framework would need an FX conversion step), 18/21/23/24/26/29 (each
  transactional slice's posting rule), and 25 (reports would need a
  presentation-currency concept). None of that is designed in this
  revision.
- Every M1 journal entry and every statutory financial report is in
  USD.

## §7. Company singleton design (this revision)

The `company` table's primary key is `id TEXT PRIMARY KEY CHECK (id =
'primary_company')`. This single line enforces, at the database level,
both halves of the singleton rule:

- **No second company row**, because `id` is the primary key and only
  one row can hold the value `'primary_company'`.
- **No differently-identified company row**, because the `CHECK`
  constraint rejects any `id` value other than `'primary_company'`
  outright, independent of the primary-key uniqueness rule.

`companyService`'s public API reinforces this at the service layer by
never accepting an `id` parameter from any caller in the first place —
there is no code path through the service capable of even attempting a
different identity. Slice 5's tests must include a **direct SQL
insertion** attempt (bypassing the service entirely) proving both
failure modes are rejected by the database itself, not only by
application-level discipline.

## §8. Decisions still open across this roadmap

These do not block Slice 5, but the roadmap assumes a default for each —
flagged so the owner can override before that default gets baked in
further downstream.

- **Placement of Recipes, Inventory Lots, and Sales Orders/Quotations
  relative to the accounting-foundations gate** (§5): this revision
  treats them as non-financial and keeps them close to their originally
  reasoned positions rather than forcing every non-explicitly-named
  module to sit after accounting. If a stricter reading was intended —
  i.e. _nothing_ except company/tax/auth/setup/users/audit and the four
  named master-data types (product, inventory item, supplier, customer)
  may precede Accounting Foundations — the master-data tier order
  changes but the accounting tier's position (16–17) does not.
- **Purchase-unit vs. consumption-unit conversion** (affects Slices 15,
  19): this roadmap currently assumes an item's purchase unit and
  consumption unit are the same, deferring real conversion factors
  (e.g. cartons → bottles) to a later refinement. If real data needs
  this sooner, it should move earlier than Slice 15.
- **Landed cost allocation** across multiple items on one goods receipt
  (Slice 18): not modeled in this pass — each receipt line is assumed
  to carry its own final cost. Flag if freight/duty needs to be spread
  across a mixed receipt.
- **Returned-stock costing** (Slice 29): assumes a returned item creates
  a new lot rather than crediting back into the original one. Confirm
  or override before Slice 29.

---

_This document was produced as a reconstruction, not a recovered
original. Review each slice's scope, dependencies, and exclusions before
treating this as frozen._

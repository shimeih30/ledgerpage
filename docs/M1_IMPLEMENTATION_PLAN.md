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
starting point.

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
2. Products, inventory, suppliers, and purchasing before recipes and
   production (you cannot cost a batch you can't yet buy materials for).
3. Customers and sales before full accounting reports (reports need real
   transactions to report on).
4. Accounting foundations (chart of accounts, general ledger) before
   payroll or advanced reporting — payroll posts to the ledger; reports
   read from it.
5. Each slice touches one coherent domain. Where two concepts are small
   and inseparable (e.g. purchase orders + goods receipts), they share a
   slice; where a domain is genuinely large (e.g. production), it is
   split across planning vs. recording.
6. A dedicated final slice handles packaging, backup, restore, and
   Windows compatibility — deliberately last, once the schema has
   stopped changing.

## 4. Roadmap at a glance

| #   | Slice                                                       | Tier         |
| --- | ----------------------------------------------------------- | ------------ |
| 5   | Company Profile & Document Numbering                        | Foundational |
| 6   | Tax Configuration                                           | Foundational |
| 7   | Authentication Foundations                                  | Foundational |
| 8   | First-Run Setup Wizard & Owner Recovery                     | Foundational |
| 9   | Users, Roles & Login                                        | Foundational |
| 10  | Audit Logging Foundation                                    | Foundational |
| 11  | Products & Variants                                         | Master data  |
| 12  | Inventory Items                                             | Master data  |
| 13  | Suppliers                                                   | Master data  |
| 14  | Inventory Lots & Stock Ledger (FIFO)                        | Master data  |
| 15  | Purchasing — Orders, Direct Purchases & Goods Receipts      | Purchasing   |
| 16  | Recipes / Bills of Material                                 | Production   |
| 17  | Production Planning & Next Production Assistant             | Production   |
| 18  | Production Batches                                          | Production   |
| 19  | Customers                                                   | Sales        |
| 20  | Sales — Quotations & Sales Orders                           | Sales        |
| 21  | Sales — Invoices, Deliveries & Payments                     | Sales        |
| 22  | Expenses                                                    | Accounting   |
| 23  | Accounting Foundations — Chart of Accounts & General Ledger | Accounting   |
| 24  | Accounting — Auto-Posting from Operational Modules          | Accounting   |
| 25  | Accounting — Core Financial Reports                         | Accounting   |
| 26  | Payroll Foundations                                         | Payroll      |
| 27  | Business Health Dashboard                                   | Reporting    |
| 28  | Business Alerts                                             | Reporting    |
| 29  | Returns & Credit Notes (Supplier and Customer)              | Hardening    |
| 30  | Sensitive-Action Approvals & Roles Hardening                | Hardening    |
| 31  | Packaging, Backup, Restore & Windows Compatibility          | Final        |

27 slices remain. This is intentionally granular — matching the size of
Slices 1–4 — rather than a smaller number of large slices.

---

## Tier A — Foundational

### Slice 5 — Company Profile & Document Numbering

**Objective.** Establish the single-company profile and the document
numbering system every later transactional table will depend on.

**Tables introduced.**

- `company` — singleton (enforced at service layer, not DB), name,
  trading name, address, contact details, `currency_id` (FK →
  `currencies`), `vat_registered` boolean, logo asset reference.
- `numbering_rules` — one row per document type: `document_type_key`,
  prefix, padding length, reset behavior (never/yearly),
  `current_sequence_value`.

**Services introduced.** `companyService` (read/update profile — Owner
only), `numberingService` (atomic "allocate next number" — advances the
sequence only at document posting time, never at draft creation, per the
already-established forward-only/no-reuse rule).

**UI introduced.** None yet — company profile editing ships with the
Slice 8 wizard and a later settings screen. This slice is schema +
service + tests only, matching how Slice 4 shipped without UI.

**Dependencies.** Slice 4 (`currencies` table, for `company.currency_id`).

**Explicit exclusions.** Multi-company switching, logo upload UI,
tax fields (Slice 6), user/owner concept (Slices 7–9).

**Acceptance criteria.**

- Exactly one `company` row can exist; a second insert attempt is
  rejected at the service layer.
- `numberingService.allocateNext('sales_order')` returns a formatted
  number matching the confirmed defaults (e.g. `SO-2026-000001`) and
  never returns the same number twice, including under simulated
  concurrent/interrupted calls.
- Yearly-reset document types roll over correctly across a simulated
  year boundary; never-reset types do not.
- No preload/IPC surface added.

---

### Slice 6 — Tax Configuration

**Objective.** Support VAT-registered and non-VAT-registered operation
without hard-coding any rate, matching the already-confirmed default
(Farmer Ben's starts not VAT-registered, no seeded rates).

**Tables introduced.**

- `tax_codes` — stable code, name, category (`standard` / `zero_rated` /
  `exempt` / `other`), active flag.
- `tax_rate_versions` — `tax_code_id`, rate (parts-per-million integer,
  not a float), `effective_from`, `effective_to` (nullable). Non-
  overlapping date ranges per code enforced at the service layer.

**Services introduced.** `taxCodeService` (CRUD, Owner/Finance only),
`taxRateResolutionService` (given a code + a transaction date, returns
the rate in effect — the function every later invoice/PO line will call).
Historical resolution must be stable: changing today's rate must never
change a transaction dated last month.

**UI introduced.** None — configuration screen ships later alongside
company settings; this slice is schema + resolution logic + tests.

**Dependencies.** Slice 5 (`company.vat_registered` flag).

**Explicit exclusions.** No tax codes are seeded. Actual tax lines on
invoices/POs are Slices 15/21's job, using this resolution service.

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
display and confirmation → completion.

**Tables introduced.** None — uses Slices 5–7's tables.

**Services introduced.** `firstRunSetupService` orchestrating the atomic
setup transaction (company + Owner user + Owner role + recovery
credential + `application_state` marker).

**UI introduced.** Setup wizard screens (multi-step), recovery-key
display/confirmation screen, completion screen. First real renderer
screens beyond the Slice 1 placeholder.

**Dependencies.** Slices 5, 6 (optional at this point), 7.

**Explicit exclusions.** Multi-company setup, email-based recovery,
any "skip setup" shortcut.

**Acceptance criteria.**

- Setup cannot complete until the person explicitly confirms the
  recovery key was saved.
- Killing the app mid-wizard leaves no partial company/user/credential
  row; relaunching restarts the wizard cleanly.
- The recovery key is displayed exactly once and cannot be retrieved
  again through the UI afterward.

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

**Dependencies.** Slices 7, 9 (to have real actors to attribute
entries to). Retrofits onto Slices 5 (company edits), 6 (tax code
edits), 9 (user/role changes).

**Explicit exclusions.** No approval workflows yet (Slice 30). No
retention/archival policy beyond "keep everything" for now.

**Acceptance criteria.**

- Every mutation added in Slices 5, 6, and 9 produces exactly one
  matching audit row.
- A deliberately-injected secret-like field name is proven never to
  reach an audit row.
- Audit rows cannot be updated or deleted through any exposed service.

---

## Tier B — Master data (before recipes/production)

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

**Explicit exclusions.** Recipes (Slice 16), inventory linkage (a
manufactured variant doesn't yet know what it consumes), sales pricing
history/discounts.

**Acceptance criteria.**

- A service-type product can be created with no variant requiring stock
  fields.
- Duplicate variant codes within the same product are rejected.
- Deactivating a product does not delete history (no history exists
  yet at this slice — this becomes testable once Slices 15/18/21 exist,
  and is re-verified then).

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
unit-conversion factors (Slice 14 and later).

**Acceptance criteria.**

- An item's base unit must reference an existing, active unit of
  measure.
- ~150 items can be created and listed without a noticeable UI delay
  (sanity check against the stated MVP scale).

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
  becomes enforceable once Slice 14 exists — the constraint is designed
  in now, verified then).

**Services introduced.** `supplierService`, `supplierPriceService`.

**UI introduced.** Supplier list/detail screens, per-supplier price
history view.

**Dependencies.** Slices 5, 12.

**Explicit exclusions.** Purchase orders, goods receipts, supplier
payments/balances (Slice 15).

**Acceptance criteria.**

- A supplier can have prices for multiple items, and an item can have
  prices from multiple suppliers.
- Recording a new supplier price does not modify any prior price row
  (append-only price history).

---

### Slice 14 — Inventory Lots & Stock Ledger (FIFO)

**Objective.** The FIFO costing engine: lots, quantity states
(physical/reserved/available/incoming), and the consumption algorithm
every later purchase and production slice will call.

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

**Dependencies.** Slice 12. Consumed by Slices 15 (receipts write lots),
18 (production reads/consumes lots), 21 (sales reserve finished-goods
"lots").

**Explicit exclusions.** Purchasing UI (Slice 15), production UI
(Slice 18), unit-conversion factors between purchase and consumption
units (flagged as an open decision below — this slice assumes item
purchase unit equals consumption unit unless that decision resolves
otherwise before this slice starts).

**Acceptance criteria.**

- The worked FIFO example already documented (20 kg @ $3.50 then 50 kg
  @ $4.20; a 30 kg consumption draws 20 kg from the first lot and 10 kg
  from the second) passes as an automated test, byte-exact on cost.
- Negative stock is impossible without an explicit, tested override
  path.
- Reserving stock reduces "available" without reducing "physical."

---

## Tier C — Purchasing

### Slice 15 — Purchasing: Orders, Direct Purchases & Goods Receipts

**Objective.** The full purchase-to-receipt flow, respecting the
already-confirmed rule set: a PO does not move inventory; a supplier
invoice does not move inventory; only a goods receipt does; partial
deliveries stay open.

**Tables introduced.**

- `purchase_orders` + `purchase_order_lines`.
- `goods_receipts` + `goods_receipt_lines` (creates `inventory_lots`
  rows via Slice 14's service).
- `direct_purchases` (a receipt with no prior PO).
- `supplier_invoices` (financial record only — no inventory effect).

**Services introduced.** `purchaseOrderService`, `goodsReceiptService`
(the only one of these that calls `fifoConsumptionService`'s sibling
lot-creation path), `directPurchaseService`.

**UI introduced.** PO creation/list, goods-receipt recording screen,
direct-purchase screen, open-PO tracking (partial delivery status).

**Dependencies.** Slices 5 (numbering), 6 (tax lines on POs/invoices),
12, 13, 14.

**Explicit exclusions.** Supplier payments and running balances
(deferred — needs Slice 23's accounting foundation to be meaningful;
tracked as a payable amount only, not posted), landed-cost allocation
across multiple items on one receipt (documented gap, candidate for a
later refinement slice), returns to suppliers (Slice 29).

**Acceptance criteria.**

- A PO with 100 units ordered and 60 received twice (partial, then
  final) ends with the correct remaining-open quantity at each step and
  zero inventory effect from the PO itself.
- A goods receipt creates exactly the lot(s) matching Slice 14's schema
  and unit cost.
- Changing a supplier's current price does not alter the unit cost of
  a previously received lot.

---

## Tier D — Recipes & Production

### Slice 16 — Recipes / Bills of Material

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
inventory base units beyond the same-unit assumption noted in Slice 14
(same open decision applies here). Production itself (Slice 18).

**Acceptance criteria.**

- Editing an active recipe creates a new version rather than mutating
  the existing row; the prior version remains readable in full.
- A recipe requires at least one ingredient before it can become
  `active`.

---

### Slice 17 — Production Planning & Next Production Assistant

**Objective.** Recommend what to produce next and preview its cost,
without ever starting production automatically. Includes overhead-rate
configuration, since the cost preview needs it.

**Tables introduced.**

- `overhead_rate_versions` — scope (`global` / product-specific),
  basis unit, rate (integer minor units per basis unit), effective
  date. (`overhead_rate_definitions` as the stable identity row,
  mirroring the tax-code pattern from Slice 6.)
- `production_plans` — recommended/requested product variant, quantity,
  priority (`critical` / `high` / `medium` / `optional`), readiness
  status, reasoning snapshot (why it's/isn't ready).

**Services introduced.** `nextProductionAssistantService` (reads
confirmed/overdue orders once Slice 20 exists — degrades gracefully to
stock-level-only recommendations until then), `productionCostPreviewService`
(materials at current FIFO cost + packaging + overhead rate + directly
assigned expected expenses).

**UI introduced.** Next Production Assistant dashboard panel, cost
preview screen for a proposed run.

**Dependencies.** Slices 14, 16. Partially depends on Slice 20 (sales
orders) for full recommendation quality — designed to work without it,
improves once it exists.

**Explicit exclusions.** Actual production recording (Slice 18).
Production-hour-based overhead (documented as a post-M1 addition per
the original allocation-method decision).

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

### Slice 18 — Production Batches

**Objective.** Record actual production: consume inventory via FIFO,
create finished goods, calculate real cost per unit, and keep the batch
as a permanent historical record.

**Tables introduced.**

- `production_batches` — `recipe_version_id`, planned/actual quantity,
  batch number (via `numberingService`), manufacturing date, expiry
  date (nullable), operator, notes, total cost, cost per unit.
- `production_batch_consumptions` — which lots were consumed, exact
  quantities (the FIFO breakdown, permanently recorded even if the
  recipe or FIFO order would differ if recalculated today).
- `production_batch_expenses` — directly assigned batch costs (fuel,
  labour, etc.) referencing `expense_categories` (Slice 4).

**Services introduced.** `productionBatchService` — orchestrates
`fifoConsumptionService` consumption, creates a new `inventory_lots` row
for the finished-goods variant, computes final cost using actual
quantities and the overhead rate in effect at batch date.

**UI introduced.** Batch recording screen, batch history/detail view.

**Dependencies.** Slices 14, 16, 17.

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

---

## Tier E — Customers & Sales

### Slice 19 — Customers

**Objective.** Customer master data and contacts, independent of any
order.

**Tables introduced.**

- `customers` — `company_id`, code, name, contact details, default
  payment terms, credit limit (nullable), active flag.
- `customer_contacts` — `customer_id`, name, role, phone/email.

**Services introduced.** `customerService`.

**UI introduced.** Customer list/detail screens.

**Dependencies.** Slice 5.

**Explicit exclusions.** Customer-specific pricing (documented as a
later refinement), outstanding-balance display (needs Slice 21).

**Acceptance criteria.**

- ~500 customers can be created and searched without a noticeable UI
  delay (sanity check against stated MVP scale).

---

### Slice 20 — Sales: Quotations & Sales Orders

**Objective.** Quotation-to-confirmed-order flow, with stock reservation
on confirmation — reservation logic lives here, not as a separate slice.

**Tables introduced.**

- `quotations` + `quotation_lines`.
- `sales_orders` + `sales_order_lines` (status: draft / confirmed /
  partially fulfilled / fulfilled / cancelled).

**Services introduced.** `quotationService`, `salesOrderService` —
confirming an order reserves finished-goods stock via Slice 14's
quantity states; does not reduce physical stock.

**UI introduced.** Quotation and sales-order creation/list screens,
quotation → order conversion action.

**Dependencies.** Slices 11, 14, 19. Feeds Slice 17's recommendation
quality once live.

**Explicit exclusions.** Invoicing, delivery, payment (Slice 21).

**Acceptance criteria.**

- Confirming a sales order reduces "available" finished-goods stock
  without reducing "physical" stock.
- Partial fulfilment leaves the correct remaining-open quantity on the
  order.

---

### Slice 21 — Sales: Invoices, Deliveries & Payments

**Objective.** Convert confirmed orders into invoices, record
deliveries, and record payments (cash and credit), tracking outstanding
and overdue balances.

**Tables introduced.**

- `invoices` + `invoice_lines` (references `tax_codes` per line).
- `deliveries` + `delivery_lines` (reduces physical finished-goods
  stock).
- `payments` — `payment_method_id` (Slice 4), amount, date, applied
  invoice(s).

**Services introduced.** `invoiceService`, `deliveryService`,
`paymentService` — outstanding/overdue balance calculations.

**UI introduced.** Invoice creation/list, delivery recording, payment
recording, customer statement view.

**Dependencies.** Slices 6, 14, 19, 20.

**Explicit exclusions.** Credit notes (Slice 29). Posting to the general
ledger (Slice 24 — this slice records the sale; Slice 24 wires the
accounting entries).

**Acceptance criteria.**

- A delivery reduces physical finished-goods stock by exactly the
  delivered quantity, drawn FIFO from finished-goods lots.
- A partial payment leaves the correct outstanding balance; an overdue
  invoice is correctly flagged based on its due date.

---

## Tier F — Expenses & Accounting

### Slice 22 — Expenses

**Objective.** Record business expenses not captured as ingredients,
packaging, or direct batch costs, classified per the existing category
list (Slice 4) and expense-nature list (direct manufacturing / indirect
overhead / selling / admin / finance / capital / owner drawing / other).

**Tables introduced.**

- `expenses` — `expense_category_id`, nature classification, amount,
  currency, `payment_method_id`, date, description, receipt reference
  (nullable), approved-by (nullable, for Slice 30).

**Services introduced.** `expenseService`.

**UI introduced.** Expense entry/list screen.

**Dependencies.** Slices 4, 5, 6.

**Explicit exclusions.** Posting to the general ledger (Slice 24).

**Acceptance criteria.**

- Every expense has exactly one category and one nature classification.
- Expenses correctly feed Slice 18's "directly assigned batch expense"
  concept when tagged to a specific batch (nullable batch reference).

---

### Slice 23 — Accounting Foundations: Chart of Accounts & General Ledger

**Objective.** Introduce proper double-entry bookkeeping structures,
building on the starter chart of accounts already designed (asset /
liability / equity / revenue / cost_of_goods_sold / expense categories,
with subtypes, immutable codes, lockable account type).

**Tables introduced.**

- `accounts` — `company_id`, immutable code, display name, category,
  subtype, `currency_id`, `parent_account_id` (nullable), type-locked
  flag, active flag.
- `journal_entries` + `journal_entry_lines` (debit/credit, must balance)
  — manual entries restricted to authorized users (Owner/Finance).

**Services introduced.** `chartOfAccountsService`, `journalEntryService`
(enforces balanced entries, immutable once posted — corrections are
reversing entries, never edits).

**UI introduced.** Chart of accounts view, manual journal entry screen
(restricted access), trial balance view.

**Dependencies.** Slices 5, 9 (authorization), 10 (audit).

**Explicit exclusions.** Automatic posting from operational modules
(Slice 24). Multi-currency ledger entries (posting stays in the
company's functional currency, per the existing decision — see the
open question on ZWG below).

**Acceptance criteria.**

- Every journal entry balances (total debits = total credits) or is
  rejected.
- A posted journal entry cannot be edited; a correction requires a new
  reversing entry, and both remain visible in history.
- The starter chart of accounts seeds correctly and matches the
  previously confirmed account list (Cash on Hand, Primary Bank, Mobile
  Money, Petty Cash, Undeposited Funds, Receivables, Payables).

---

### Slice 24 — Accounting: Auto-Posting from Operational Modules

**Objective.** Wire the modules already built (purchasing, production,
sales, expenses) to post accounting entries automatically, so a
non-accountant never has to think in debits and credits for ordinary
operations.

**Tables introduced.** None — uses Slice 23's tables.

**Services introduced.** `postingService` — one function per business
event (goods receipt, production batch completion, invoice, payment,
expense) that produces the correct balanced journal entry, called from
inside each existing operational service.

**UI introduced.** None new — journal entries created this way appear
in Slice 23's views, tagged with their originating transaction.

**Dependencies.** Slices 15, 18, 21, 22, 23.

**Explicit exclusions.** Retroactive posting of any transaction recorded
before this slice ships (documented as an acceptable MVP gap — this
plan does not include a backfill tool; flagged for owner awareness).

**Acceptance criteria.**

- Recording a goods receipt, completing a production batch, posting an
  invoice, recording a payment, and recording an expense each produce
  exactly one balanced journal entry, verified against the specific
  accounts involved.
- No operational action can complete "successfully" while silently
  failing to post its accounting entry — a posting failure rolls back
  the whole operation (same all-or-nothing pattern already used for
  reference-data seeding).

---

### Slice 25 — Accounting: Core Financial Reports

**Objective.** Profit & Loss, Balance Sheet, Trial Balance, and basic
Cash Flow, generated from the general ledger.

**Tables introduced.** None — read-only reporting over Slice 23/24 data.

**Services introduced.** `reportingService` (P&L, balance sheet, trial
balance, cash flow — for a selected date range).

**UI introduced.** Report screens (selectable date range, export/print
as a later refinement).

**Dependencies.** Slices 23, 24.

**Explicit exclusions.** Multi-period comparison views, budget-vs-actual
(candidates for a later milestone).

**Acceptance criteria.**

- The trial balance always balances by construction (sum of all
  account balances nets to zero).
- P&L and balance sheet figures reconcile against a manually
  constructed test scenario spanning a purchase, a production batch, a
  sale, and an expense.

---

## Tier G — Payroll, Dashboard, Alerts

### Slice 26 — Payroll Foundations

**Objective.** Minimal payroll: employees, salaries, and payslips, with
statutory deductions modeled as fully configurable data — never
hard-coded Zimbabwean rates, since these change.

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
date; posts to the general ledger via Slice 24's posting pattern.

**UI introduced.** Employee list, salary setup, payslip generation and
view.

**Dependencies.** Slices 9, 23, 24.

**Explicit exclusions.** Loans/advances against salary, leave tracking,
tax-authority filing/submission integrations (all documented as
post-M1).

**Acceptance criteria.**

- Changing a statutory rate today does not alter a previously issued
  payslip's figures.
- A payslip posts a balanced journal entry (salary expense, statutory
  liability accounts, net pay).

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

**Dependencies.** Slices 14, 17, 20, 21, 22, 25 (the more of these that
exist, the more complete the dashboard — designed to degrade gracefully
if run against a partial dataset, same principle as Slice 17).

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

## Tier H — Hardening

### Slice 29 — Returns & Credit Notes (Supplier and Customer)

**Objective.** Handle the return paths deliberately excluded from
Slices 15 and 21: returns to suppliers (damaged/rejected goods) and
customer returns/credit notes.

**Tables introduced.**

- `supplier_returns` + lines (reverses the relevant lot quantity,
  reduces a payable).
- `customer_credit_notes` + lines (reduces a receivable, may restock or
  write off the returned item).

**Services introduced.** `supplierReturnService`, `creditNoteService` —
both post accounting entries via Slice 24's pattern.

**UI introduced.** Return/credit-note recording screens on both sides.

**Dependencies.** Slices 15, 21, 24.

**Explicit exclusions.** Restocking a returned item to a _new_ lot with
its own cost is the assumed default; the alternative (crediting back
into the original lot) is flagged below as a decision worth confirming
before this slice starts.

**Acceptance criteria.**

- A supplier return correctly reduces the relevant payable and does not
  silently re-inflate stock it shouldn't.
- A customer credit note correctly reduces the customer's outstanding
  balance and posts the matching accounting entry.

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
existing services from Slices 6 (price changes), 12/14 (write-offs,
expired-stock overrides), 15 (large POs), 23 (manual journal entries).

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

## Tier I — Final

### Slice 31 — Packaging, Backup, Restore & Windows Compatibility

**Objective.** Everything needed to actually ship LedgerPage: a
packaged installer, a trustworthy backup/restore story, and confirmed
Windows compatibility — deliberately last, once the schema has settled.

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

## 5. Decisions still open across this roadmap

These are noted at the slice level above but summarized here since they
affect more than one slice. They do not block Slice 5, but the roadmap
assumes a default for each — flagged so the owner can override before
that default gets baked in further downstream.

- **Purchase-unit vs. consumption-unit conversion** (affects Slices 14,
  16): this roadmap currently assumes an item's purchase unit and
  consumption unit are the same, deferring real conversion factors
  (e.g. cartons → bottles) to a later refinement. If real data needs
  this sooner, it should move earlier than Slice 14.
- **Landed cost allocation** across multiple items on one goods receipt
  (Slice 15): not modeled in this pass — each receipt line is assumed
  to carry its own final cost. Flag if freight/duty needs to be spread
  across a mixed receipt.
- **Returned-stock costing** (Slice 29): assumes a returned item creates
  a new lot rather than crediting back into the original one. Confirm
  or override before Slice 29.
- **Retroactive posting** (Slice 24): transactions recorded in Slices
  15/18/21/22 before Slice 24 ships will not automatically get journal
  entries. No backfill tool is planned in this roadmap; flag if that's
  needed.

---

_This document was produced as a reconstruction, not a recovered
original. Review each slice's scope, dependencies, and exclusions before
treating this as frozen._

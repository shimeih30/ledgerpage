/**
 * Drizzle schema for LedgerPage.
 *
 * Slice 4 introduced the first permanent tables: stable reference data
 * that later business tables reference (currencies, units of measure,
 * payment methods, expense categories).
 *
 * Slice 5 introduced the first genuinely company-owned tables: `company`
 * (a database-and-service-enforced singleton — see the CHECK constraint
 * below) and `numbering_rules` (the document-numbering configuration
 * every later transactional table will allocate numbers from). Neither
 * table is seeded with real data by that slice — see
 * src/main/db/companyService.ts and src/main/db/numberingService.ts.
 *
 * Slice 6 introduces tax configuration: `tax_codes` (company-scoped tax
 * code identities — standard/zero_rated/exempt/other) and
 * `tax_rate_versions` (effective-dated rate history per code, so a rate
 * change never alters the tax rate that applied to an older transaction
 * date). Neither table is seeded by this slice either — see
 * src/main/db/taxCodeService.ts, taxRateVersionService.ts, and
 * taxRateResolutionService.ts.
 *
 * Timestamp convention (established in Slice 4, no prior decision pinned
 * the exact unit): created_at/updated_at are stored as Unix epoch
 * milliseconds via Drizzle's `timestamp_ms` mode, matching JS `Date`
 * directly. Every timestamp column in this file uses this same mode.
 *
 * Calendar-date convention (established this slice): a field representing
 * a calendar date rather than an instant (tax_rate_versions.effective_from
 * / effective_to) is stored as ISO 8601 `YYYY-MM-DD` TEXT, never as a
 * timestamp and never compared via a constructed JS Date — zero-padded
 * ISO date strings compare correctly both lexicographically and
 * chronologically, which keeps date-range logic immune to the machine's
 * local timezone (verified empirically before this schema was written).
 */
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

/**
 * Columns shared by every reference-data table in this slice. Not a
 * general framework — just a small helper to keep the four tables below
 * from repeating the same eight column definitions verbatim.
 */
function referenceDataColumns() {
  return {
    id: text('id').primaryKey(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  }
}

export const currencies = sqliteTable('currencies', {
  ...referenceDataColumns(),
  symbol: text('symbol'),
  decimalPlaces: integer('decimal_places').notNull().default(2)
})

export const unitsOfMeasure = sqliteTable('units_of_measure', {
  ...referenceDataColumns(),
  category: text('category').notNull(),
  decimalPlaces: integer('decimal_places').notNull().default(3)
})

export const paymentMethods = sqliteTable('payment_methods', {
  ...referenceDataColumns()
})

export const expenseCategories = sqliteTable('expense_categories', {
  ...referenceDataColumns()
})

/**
 * The stable ID every `company` row must use — enforced by the CHECK
 * constraint below, not just by convention. Exported so services never
 * need to hard-code the literal string in more than one place.
 *
 * Used via sql.raw() (not sql`${...}`) in the CHECK constraints below:
 * SQLite rejects bound parameters inside a CHECK constraint definition
 * ("parameters prohibited in CHECK constraints") — confirmed directly
 * against a real connection before this schema was written — so the
 * value must be inlined as a literal, not interpolated as a parameter.
 */
export const PRIMARY_COMPANY_ID = 'primary_company'
const primaryCompanyIdLiteral = sql.raw(`'${PRIMARY_COMPANY_ID}'`)

/**
 * The frozen functional currency (see the M1 plan's decision log: "USD
 * functional currency; ZWG/ZAR/BWP/CNY are reference-only"). Not a
 * setting — there is no code path anywhere in this application that
 * lets a caller choose a different functional currency for the
 * company row. Slice 8's first-run setup uses this constant directly
 * rather than accepting a currencyId from its own input, and its
 * "currency confirmation" wizard stage is a read-only confirmation of
 * this fact, not a picker among the other seeded (reference-only)
 * currencies.
 */
export const FUNCTIONAL_CURRENCY_ID = 'currency_usd'

/**
 * Singleton company profile. The CHECK constraint means SQLite itself
 * rejects any row whose id isn't exactly PRIMARY_COMPANY_ID, and the
 * PRIMARY KEY means SQLite itself rejects a second row even with the
 * correct id — both verified empirically against a real connection
 * before this schema was written. No row is seeded by Slice 5; the real
 * company row is created by Slice 8's first-run transaction.
 */
export const company = sqliteTable(
  'company',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    tradingName: text('trading_name'),
    address: text('address').notNull(),
    contactDetails: text('contact_details').notNull(),
    currencyId: text('currency_id')
      .notNull()
      .references(() => currencies.id),
    vatRegistered: integer('vat_registered', { mode: 'boolean' }).notNull().default(false),
    logoAssetPath: text('logo_asset_path'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [check('company_singleton_id', sql`${t.id} = ${primaryCompanyIdLiteral}`)]
)

/**
 * Document-numbering configuration, one row per document type. Company-
 * scoped (per the approved architecture's company-owned-data pattern)
 * even though MVP has exactly one company; the redundant CHECK on
 * company_id (in addition to the FK) means the constraint is visible
 * directly on this table without needing to cross-reference `company`'s
 * own constraint. No rows are seeded by Slice 5 — see
 * src/main/db/numberingDefaults.ts for the frozen default data Slice 8
 * will insert.
 */
export const numberingRules = sqliteTable(
  'numbering_rules',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    documentTypeKey: text('document_type_key').notNull(),
    prefix: text('prefix').notNull(),
    paddingLength: integer('padding_length').notNull(),
    resetBehavior: text('reset_behavior').notNull(),
    currentSequenceValue: integer('current_sequence_value').notNull().default(0),
    currentSequenceYear: integer('current_sequence_year'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('numbering_rules_company_document_type_unique').on(t.companyId, t.documentTypeKey),
    check('numbering_rules_company_is_singleton', sql`${t.companyId} = ${primaryCompanyIdLiteral}`),
    check(
      'numbering_rules_padding_length_sensible',
      sql`${t.paddingLength} > 0 AND ${t.paddingLength} <= 10`
    ),
    check('numbering_rules_reset_behavior_valid', sql`${t.resetBehavior} IN ('never', 'yearly')`),
    check('numbering_rules_sequence_non_negative', sql`${t.currentSequenceValue} >= 0`),
    check(
      'numbering_rules_year_sensible',
      sql`${t.currentSequenceYear} IS NULL OR (${t.currentSequenceYear} >= 1000 AND ${t.currentSequenceYear} <= 9999)`
    )
  ]
)

/**
 * The four approved tax categories. `standard` and `other` require a
 * numeric rate on their rate versions; `zero_rated` and `exempt` resolve
 * to zero without requiring one — enforced at the service layer (Drizzle
 * CHECK constraints cannot reference another table's column, and the
 * rate lives on tax_rate_versions while category lives here).
 */
export const TAX_CODE_CATEGORIES = ['standard', 'zero_rated', 'exempt', 'other'] as const

/**
 * Company-scoped tax code identities. Company-owned data (per the
 * approved architecture's company-owned-data pattern), with the same
 * redundant CHECK-plus-FK singleton pattern already used by
 * numbering_rules. No rows are seeded by this slice.
 */
export const taxCodes = sqliteTable(
  'tax_codes',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    description: text('description'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('tax_codes_company_code_unique').on(t.companyId, t.code),
    check('tax_codes_company_is_singleton', sql`${t.companyId} = ${primaryCompanyIdLiteral}`),
    check(
      'tax_codes_category_valid',
      sql`${t.category} IN ('standard', 'zero_rated', 'exempt', 'other')`
    )
  ]
)

/**
 * Effective-dated rate history per tax code. rate_ppm is parts per
 * million (15% = 150,000; see taxValidation.ts's ppmFromPercent for the
 * exact, tested conversion) — an integer, never a float, so no rounding
 * error can creep into a stored rate. Nullable because zero_rated/exempt
 * codes don't need a stored numeric rate at all (they resolve to zero by
 * category); standard/other codes are required to supply one, enforced
 * at the service layer where the tax code's category is available.
 *
 * effective_from/effective_to are ISO YYYY-MM-DD calendar dates (not
 * timestamps) — see the module-level doc comment above for why. The
 * GLOB constraints below are a defense-in-depth shape check (verified
 * empirically to correctly reject non-date-shaped strings); full
 * calendar validity (rejecting e.g. 2026-02-30) is the service layer's
 * job, since SQLite's GLOB can check shape but not calendar correctness.
 *
 * Cross-row overlap prevention (two versions of the same tax code must
 * never cover the same date) cannot be expressed as a CHECK constraint
 * at all — SQLite CHECK constraints only see one row — so that rule
 * lives entirely in taxRateVersionService, inside the same transaction
 * as the write.
 */
export const taxRateVersions = sqliteTable(
  'tax_rate_versions',
  {
    id: text('id').primaryKey(),
    taxCodeId: text('tax_code_id')
      .notNull()
      .references(() => taxCodes.id),
    ratePpm: integer('rate_ppm'),
    effectiveFrom: text('effective_from').notNull(),
    effectiveTo: text('effective_to'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    check('tax_rate_versions_rate_non_negative', sql`${t.ratePpm} IS NULL OR ${t.ratePpm} >= 0`),
    // Maximum is a deliberate, documented choice: not capped at 100% —
    // the 'other' category may need unusual excise/duty-style rates
    // later without a schema change — but bounded well below "anything
    // goes" to still catch an obvious data-entry error (e.g. entering a
    // rate two orders of magnitude too large).
    check('tax_rate_versions_rate_max', sql`${t.ratePpm} IS NULL OR ${t.ratePpm} <= 5000000`),
    check(
      'tax_rate_versions_from_shape',
      sql`${t.effectiveFrom} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      'tax_rate_versions_to_shape',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`
    ),
    check(
      'tax_rate_versions_date_order',
      sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} >= ${t.effectiveFrom}`
    )
  ]
)

/**
 * Slice 7: authentication and authorization primitives. No user rows,
 * user_role assignments, recovery credentials, or login events are
 * seeded by this slice — see src/main/auth/. `roles` is the one
 * exception: it is global, fixed application reference data (not
 * company-scoped, matching the project's established classification of
 * role definitions), idempotently seeded by seedRoles.ts.
 *
 * Foreign-key actions below are chosen deliberately, not left as
 * SQLite's default, and documented individually — see each table's
 * comment. None of this slice's services ever hard-deletes a user or
 * role (deactivation only); the RESTRICT actions exist so that if a
 * delete were ever attempted some other way, SQLite refuses it outright
 * rather than silently destroying security history.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    loginIdentifier: text('login_identifier').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    passwordChangedAt: integer('password_changed_at', { mode: 'timestamp_ms' }).notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('users_company_login_identifier_unique').on(t.companyId, t.loginIdentifier),
    check('users_company_is_singleton', sql`${t.companyId} = ${primaryCompanyIdLiteral}`),
    check('users_failed_login_count_non_negative', sql`${t.failedLoginCount} >= 0`)
  ]
)

/**
 * Global, fixed application reference data — not company-scoped. Seeded
 * idempotently (insert-missing-only, never overwrite an edited row) by
 * seedRoles.ts during normal startup, the same pattern Slice 4 already
 * established for currencies/units/payment methods/expense categories.
 */
export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
})

/**
 * user_id/role_id both ON DELETE RESTRICT: an assignment history should
 * never silently vanish because a user or role row was removed some
 * other way. No user_role rows are seeded or created by this slice.
 */
export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })]
)

/**
 * user_id ON DELETE RESTRICT (same reasoning as user_roles): recovery
 * credential history — including revoked/inactive rows — must survive
 * independent of any hypothetical future user-deletion path.
 *
 * "At most one active recovery credential per user" is enforced with a
 * partial unique index (`WHERE is_active = 1`), not a plain UNIQUE
 * constraint — verified empirically against a real connection before
 * this schema was written: a second active row for the same user is
 * rejected, while any number of inactive (revoked) rows are freely
 * allowed to remain as history.
 */
export const ownerRecoveryCredentials = sqliteTable(
  'owner_recovery_credentials',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    recoveryKeyHash: text('recovery_key_hash').notNull(),
    version: integer('version').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
  },
  (t) => [
    uniqueIndex('owner_recovery_credentials_one_active_per_user')
      .on(t.userId)
      .where(sql`${t.isActive} = 1`),
    check('owner_recovery_credentials_version_positive', sql`${t.version} > 0`)
  ]
)

/**
 * user_id ON DELETE SET NULL: unlike the tables above, user_id here is
 * already nullable and NULL already carries meaning ("no matching
 * user" — a failed login attempt against a nonexistent identifier).
 * Allowing it to become NULL if a referenced user row were ever removed
 * is consistent with that existing meaning; RESTRICT here would make
 * user deletion permanently impossible after a single login, a much
 * stronger constraint than this slice intends to impose. Login events
 * themselves are never deleted or edited by any service — this table is
 * append-only.
 *
 * Privacy: no IP address, no device identifier, and no attempted
 * unmatched login identifier is ever stored here — see
 * src/main/auth/authenticationService.ts.
 */
export const loginEvents = sqliteTable(
  'login_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    success: integer('success', { mode: 'boolean' }).notNull(),
    source: text('source').notNull()
  },
  (t) => [
    check(
      'login_events_source_valid',
      sql`${t.source} IN ('normal_login', 'session_unlock', 'owner_recovery')`
    )
  ]
)

/**
 * Slice 10: append-only audit trail. No service exposed anywhere in this
 * codebase updates or deletes a row here — see auditService.ts, whose
 * only exported write operation is `record`, which only ever inserts.
 *
 * user_id uses ON DELETE RESTRICT, not SET NULL — deliberately, and
 * unlike login_events above. This app never hard-deletes a user (only
 * deactivates), so the distinction is aspirational today, but it matters
 * for a reason beyond that: this table also carries a CHECK constraint
 * (audit_log_entries_actor_user_consistency) requiring every 'user'-actor
 * row to have a non-null user_id. Combining that CHECK with ON DELETE SET
 * NULL would be a live contradiction — a hypothetical future user
 * deletion would silently violate the actor-consistency invariant this
 * same migration defines. RESTRICT keeps attribution intact and makes
 * the two constraints consistent with each other by construction, not by
 * hoping the SET NULL path never actually gets exercised.
 *
 * changed_fields is a JSON-encoded object of `{field: {old, new}}` pairs
 * — only fields that actually changed for update/deactivate/reactivate;
 * every field as {old: null, new: value} for create. Redaction (see
 * auditService.ts's recursive redactor) happens before this column is
 * ever written, not at read time — an unredacted secret is never even
 * momentarily persisted.
 *
 * Composite index on (occurred_at, id) supports the cursor-paginated
 * listing (Correction 6: never return the complete table) with stable,
 * gap-free ordering — id is included because occurred_at alone is not
 * guaranteed unique (two entries in the same transaction can share a
 * millisecond timestamp).
 */
export const auditLogEntries = sqliteTable(
  'audit_log_entries',
  {
    id: text('id').primaryKey(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    entityLabel: text('entity_label').notNull(),
    action: text('action').notNull(),
    changedFields: text('changed_fields'),
    actorType: text('actor_type').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'restrict' }),
    companyId: text('company_id').references(() => company.id, { onDelete: 'restrict' }),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    check(
      'audit_log_entries_action_valid',
      sql`${t.action} IN ('create', 'update', 'deactivate', 'reactivate')`
    ),
    check('audit_log_entries_actor_type_valid', sql`${t.actorType} IN ('user', 'system')`),
    check(
      'audit_log_entries_actor_user_consistency',
      sql`(${t.actorType} = 'system' AND ${t.userId} IS NULL) OR (${t.actorType} = 'user' AND ${t.userId} IS NOT NULL)`
    ),
    index('audit_log_entries_occurred_at_id_idx').on(t.occurredAt, t.id),
    index('audit_log_entries_entity_type_idx').on(t.entityType)
  ]
)

/**
 * Slice 11: the product catalog. `code` is never accepted as input from
 * any caller — it is always allocated by numberingService.allocateNext
 * ('product', ...) inside the same transaction as the insert (see
 * productService.ts), using the `product` numbering rule Slice 8's
 * first-run transaction already seeds (prefix PRD, never-reset). Once
 * created, code is immutable — no update path in productService.ts
 * accepts a code value at all.
 *
 * type is a fixed two-value enum: 'manufactured' variants may carry a
 * nonzero minimum finished-stock level; 'service' variants may not
 * (enforced in productVariantService.ts, not expressible as a
 * cross-table CHECK constraint since SQLite CHECK constraints only see
 * one row and product type lives on the parent).
 */
export const PRODUCT_TYPES = ['manufactured', 'service'] as const

export const products = sqliteTable(
  'products',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('products_company_code_unique').on(t.companyId, t.code),
    check('products_company_is_singleton', sql`${t.companyId} = ${primaryCompanyIdLiteral}`),
    check('products_type_valid', sql`${t.type} IN ('manufactured', 'service')`)
  ]
)

/**
 * Slice 11: variants of a product (e.g. 100 ml / 200 ml / 2 L). Unlike
 * products.code, product_variants.code is ordinary user-entered input —
 * no numbering rule exists for variants — validated unique *within its
 * parent product* only (products_variants_product_code_unique below),
 * not company-wide; two different products may each have their own
 * "100ML" variant.
 *
 * product_id uses the default FK action (effectively RESTRICT-like:
 * SQLite refuses a delete that would orphan a referencing row unless an
 * explicit ON DELETE clause says otherwise) — consistent with this
 * app's standing "never hard-delete, only deactivate" posture; nothing
 * in this codebase ever attempts to delete a products row, so this is
 * defense in depth, not a path this slice actually exercises.
 *
 * selling_price_minor is an integer (never a float), matching
 * tax_rate_versions.rate_ppm's own "no floating-point money/rate
 * arithmetic" precedent. currency_id is present because the plan
 * requires price-plus-currency, but productVariantService.ts never
 * accepts it as caller input — every row is written with
 * FUNCTIONAL_CURRENCY_ID, mirroring company.currency_id's own "no code
 * path lets a caller choose a different functional currency" posture.
 *
 * tax_code_id is nullable (a variant need not have a tax code yet) and,
 * once set, is never cleared by a later tax-code deactivation — a
 * deactivated tax code simply stops being *assignable* to new/updated
 * variants (enforced in productVariantService.ts), while any variant
 * already referencing it keeps that reference intact, exactly like
 * tax_rate_versions' own historical-rate stability requirement.
 *
 * barcode is nullable; empty input is normalized to NULL before this
 * column is ever written (see productVariantService.ts), so the partial
 * unique index below only ever has to reject a genuine duplicate real
 * barcode, never two coincidentally-blank ones.
 *
 * minimum_finished_stock_level has no operational meaning yet
 * (inventory linkage doesn't exist until Slice 12) — captured now,
 * enforced now (non-negative; zero-only for a service-type variant, via
 * productVariantService.ts since a CHECK constraint here can't see the
 * parent product's type), consumed later.
 */
export const productVariants = sqliteTable(
  'product_variants',
  {
    id: text('id').primaryKey(),
    productId: text('product_id')
      .notNull()
      .references(() => products.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sellingPriceMinor: integer('selling_price_minor').notNull(),
    currencyId: text('currency_id')
      .notNull()
      .references(() => currencies.id),
    taxCodeId: text('tax_code_id').references(() => taxCodes.id),
    barcode: text('barcode'),
    minimumFinishedStockLevel: integer('minimum_finished_stock_level').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('product_variants_product_code_unique').on(t.productId, t.code),
    uniqueIndex('product_variants_barcode_unique')
      .on(t.barcode)
      .where(sql`${t.barcode} IS NOT NULL`),
    check('product_variants_selling_price_non_negative', sql`${t.sellingPriceMinor} >= 0`),
    check('product_variants_min_stock_non_negative', sql`${t.minimumFinishedStockLevel} >= 0`)
  ]
)

/**
 * Slice 12: the item master catalog for everything purchased or
 * consumed internally (ingredients, packaging, other consumables) — no
 * quantities-on-hand, lots, or supplier links yet (Slices 13/15).
 *
 * code is ordinary user-entered input, unique within the company (this
 * app's one company) and immutable after creation — approved decision:
 * unlike products.code, no numbering rule is added for this table.
 * inventoryItemService.ts never accepts a code value on update, a
 * structural guarantee at the input-type level, not merely a
 * runtime-rejected one.
 *
 * unit_of_measure_id is required (unlike product_variants.tax_code_id,
 * which is nullable) and, once set, is never cleared or cascaded by a
 * later deactivation of that unit — mirroring tax_code_id's own
 * historical-reference-stability precedent exactly, just applied to a
 * required rather than optional column. New assignments must reference
 * a currently-active unit (enforced in inventoryItemService.ts, not
 * expressible as a CHECK constraint here since SQLite CHECK constraints
 * cannot see another table's row).
 *
 * minimum_stock, reorder_quantity, and lead_time_days are required,
 * non-negative integers; maximum_stock is nullable but, when present,
 * must be non-negative and >= minimum_stock — the cross-field half of
 * that rule is enforced in the service layer, since SQLite CHECK
 * constraints can reference other columns on the same row but the
 * combination here (nullable column compared conditionally) is clearer
 * expressed procedurally; the non-negative half of each is still a real
 * CHECK constraint below, so direct-SQL bypass is covered for that part.
 */
export const INVENTORY_ITEM_TYPES = ['ingredient', 'packaging', 'consumable', 'other'] as const

export const inventoryItems = sqliteTable(
  'inventory_items',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => company.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    itemType: text('item_type').notNull(),
    unitOfMeasureId: text('unit_of_measure_id')
      .notNull()
      .references(() => unitsOfMeasure.id),
    minimumStock: integer('minimum_stock').notNull().default(0),
    reorderQuantity: integer('reorder_quantity').notNull().default(0),
    maximumStock: integer('maximum_stock'),
    leadTimeDays: integer('lead_time_days').notNull().default(0),
    lotTracked: integer('lot_tracked', { mode: 'boolean' }).notNull().default(false),
    expiryTracked: integer('expiry_tracked', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull()
  },
  (t) => [
    unique('inventory_items_company_code_unique').on(t.companyId, t.code),
    check('inventory_items_company_is_singleton', sql`${t.companyId} = ${primaryCompanyIdLiteral}`),
    check(
      'inventory_items_item_type_valid',
      sql`${t.itemType} IN ('ingredient', 'packaging', 'consumable', 'other')`
    ),
    check('inventory_items_minimum_stock_non_negative', sql`${t.minimumStock} >= 0`),
    check('inventory_items_reorder_quantity_non_negative', sql`${t.reorderQuantity} >= 0`),
    check('inventory_items_lead_time_days_non_negative', sql`${t.leadTimeDays} >= 0`),
    check(
      'inventory_items_maximum_stock_non_negative',
      sql`${t.maximumStock} IS NULL OR ${t.maximumStock} >= 0`
    ),
    check(
      'inventory_items_maximum_stock_gte_minimum_stock',
      sql`${t.maximumStock} IS NULL OR ${t.maximumStock} >= ${t.minimumStock}`
    )
  ]
)

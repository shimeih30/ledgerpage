/**
 * Drizzle schema for LedgerPage.
 *
 * Slice 4 introduced the first permanent tables: stable reference data
 * that later business tables reference (currencies, units of measure,
 * payment methods, expense categories).
 *
 * Slice 5 introduces the first genuinely company-owned tables: `company`
 * (a database-and-service-enforced singleton — see the CHECK constraint
 * below) and `numbering_rules` (the document-numbering configuration
 * every later transactional table will allocate numbers from). Neither
 * table is seeded with real data by this slice — see
 * src/main/db/companyService.ts and src/main/db/numberingService.ts.
 *
 * Timestamp convention (established in Slice 4, no prior decision pinned
 * the exact unit): created_at/updated_at are stored as Unix epoch
 * milliseconds via Drizzle's `timestamp_ms` mode, matching JS `Date`
 * directly. Every timestamp column in this file uses this same mode.
 */
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'
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

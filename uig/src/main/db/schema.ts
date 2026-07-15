/**
 * Drizzle schema for LedgerPage.
 *
 * Slice 4 introduces the first permanent tables: stable reference data
 * that later business tables will reference (currencies, units of
 * measure, payment methods, expense categories). No operational tables
 * (products, inventory, customers, orders, accounting, production) exist
 * yet.
 *
 * Timestamp convention (established this slice, no prior decision pinned
 * the exact unit): created_at/updated_at are stored as Unix epoch
 * milliseconds via Drizzle's `timestamp_ms` mode, matching JS `Date`
 * directly. Every timestamp column in this file, and expected in future
 * schema additions, should use this same mode for consistency.
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

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

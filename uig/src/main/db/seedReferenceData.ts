import type Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { currencies, expenseCategories, paymentMethods, unitsOfMeasure } from './schema'
import { currencySeedRows } from './seedData/currencies'
import { unitOfMeasureSeedRows } from './seedData/unitsOfMeasure'
import { paymentMethodSeedRows } from './seedData/paymentMethods'
import { expenseCategorySeedRows } from './seedData/expenseCategories'
import type { ReferenceDataSeedRow } from './seedData/types'
import {
  validateDecimalPlaces,
  validateReferenceDataRow,
  validateUnitCategory
} from './validation/referenceDataValidation'

function requireExtraNumber(row: ReferenceDataSeedRow, key: string): number {
  const value = row.extra?.[key]
  if (typeof value !== 'number') {
    throw new Error(`Seed row "${row.id}" is missing required numeric field "${key}"`)
  }
  return value
}

function requireExtraString(row: ReferenceDataSeedRow, key: string): string {
  const value = row.extra?.[key]
  if (typeof value !== 'string') {
    throw new Error(`Seed row "${row.id}" is missing required string field "${key}"`)
  }
  return value
}

/**
 * Seeds the four Slice 4 reference-data tables. Called after migrations,
 * before the app is considered ready to open its window.
 *
 * Idempotent: every insert targets the stable row `id` with
 * onConflictDoNothing, so an existing row (including one a user has since
 * edited — renamed, deactivated, reordered) is left completely untouched.
 * There is no upsert/update path here by design.
 *
 * Runs inside a single transaction across all four tables: a validation
 * or insert failure partway through leaves no partial seed data behind,
 * and propagates to the caller (initializeDatabase), which is expected to
 * close the connection and treat this as a startup failure.
 */
export function seedReferenceData(db: Database.Database): void {
  const orm = drizzle(db)

  orm.transaction((tx) => {
    const now = new Date()

    for (const row of currencySeedRows) {
      validateReferenceDataRow(row, 'currencies')
      const decimalPlaces = requireExtraNumber(row, 'decimalPlaces')
      validateDecimalPlaces(decimalPlaces, 'currencies', row.id)
      const symbol = row.extra?.symbol
      if (symbol !== undefined && typeof symbol !== 'string') {
        throw new Error(`Seed row "${row.id}" has a non-string symbol`)
      }

      tx.insert(currencies)
        .values({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sortOrder,
          symbol: symbol ?? null,
          decimalPlaces,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: currencies.id })
        .run()
    }

    for (const row of unitOfMeasureSeedRows) {
      validateReferenceDataRow(row, 'units_of_measure')
      const category = requireExtraString(row, 'category')
      validateUnitCategory(category, row.id)
      const decimalPlaces = requireExtraNumber(row, 'decimalPlaces')
      validateDecimalPlaces(decimalPlaces, 'units_of_measure', row.id)

      tx.insert(unitsOfMeasure)
        .values({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sortOrder,
          category,
          decimalPlaces,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: unitsOfMeasure.id })
        .run()
    }

    for (const row of paymentMethodSeedRows) {
      validateReferenceDataRow(row, 'payment_methods')

      tx.insert(paymentMethods)
        .values({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sortOrder,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: paymentMethods.id })
        .run()
    }

    for (const row of expenseCategorySeedRows) {
      validateReferenceDataRow(row, 'expense_categories')

      tx.insert(expenseCategories)
        .values({
          id: row.id,
          code: row.code,
          name: row.name,
          description: row.description,
          sortOrder: row.sortOrder,
          createdAt: now,
          updatedAt: now
        })
        .onConflictDoNothing({ target: expenseCategories.id })
        .run()
    }
  })
}

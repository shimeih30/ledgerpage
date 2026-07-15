import { APPROVED_UNIT_CATEGORIES, type UnitCategory } from '../seedData/unitsOfMeasure'
import type { ReferenceDataSeedRow } from '../seedData/types'

export class ReferenceDataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReferenceDataValidationError'
  }
}

/**
 * Validates the fields shared by every reference-data table. Intentionally
 * narrow — this checks the specific things this slice's rows need
 * checked, not a general-purpose schema validation framework.
 */
export function validateReferenceDataRow(row: ReferenceDataSeedRow, tableLabel: string): void {
  if (row.code.trim().length === 0) {
    throw new ReferenceDataValidationError(
      `${tableLabel}: code must not be empty (row id "${row.id}")`
    )
  }

  if (row.name.trim().length === 0) {
    throw new ReferenceDataValidationError(
      `${tableLabel}: name must not be empty (row id "${row.id}")`
    )
  }

  if (!Number.isInteger(row.sortOrder)) {
    throw new ReferenceDataValidationError(
      `${tableLabel}: sortOrder must be an integer (row id "${row.id}", received ${String(row.sortOrder)})`
    )
  }
}

/**
 * Validates decimal_places for tables that have it (currencies,
 * units_of_measure): must be a sensible non-negative integer.
 */
export function validateDecimalPlaces(value: number, tableLabel: string, rowId: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new ReferenceDataValidationError(
      `${tableLabel}: decimalPlaces must be a non-negative integer (row id "${rowId}", received ${String(value)})`
    )
  }
}

/**
 * Validates a unit-of-measure's category against the approved list.
 */
export function validateUnitCategory(value: string, rowId: string): asserts value is UnitCategory {
  if (!(APPROVED_UNIT_CATEGORIES as readonly string[]).includes(value)) {
    throw new ReferenceDataValidationError(
      `units_of_measure: category "${value}" is not approved (row id "${rowId}"). ` +
        `Approved categories: ${APPROVED_UNIT_CATEGORIES.join(', ')}`
    )
  }
}

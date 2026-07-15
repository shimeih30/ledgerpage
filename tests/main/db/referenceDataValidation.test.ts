import { describe, expect, it } from 'vitest'
import {
  ReferenceDataValidationError,
  validateDecimalPlaces,
  validateReferenceDataRow,
  validateUnitCategory
} from '../../../src/main/db/validation/referenceDataValidation'
import type { ReferenceDataSeedRow } from '../../../src/main/db/seedData/types'

function baseRow(overrides: Partial<ReferenceDataSeedRow> = {}): ReferenceDataSeedRow {
  return {
    id: 'test_row',
    code: 'TEST',
    name: 'Test Row',
    description: null,
    sortOrder: 0,
    ...overrides
  }
}

describe('validateReferenceDataRow', () => {
  it('accepts a well-formed row', () => {
    expect(() => validateReferenceDataRow(baseRow(), 'test_table')).not.toThrow()
  })

  it('rejects an empty code', () => {
    expect(() => validateReferenceDataRow(baseRow({ code: '' }), 'test_table')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects a whitespace-only code', () => {
    expect(() => validateReferenceDataRow(baseRow({ code: '   ' }), 'test_table')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects an empty name', () => {
    expect(() => validateReferenceDataRow(baseRow({ name: '' }), 'test_table')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects a whitespace-only name', () => {
    expect(() => validateReferenceDataRow(baseRow({ name: '   ' }), 'test_table')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects a non-integer sortOrder', () => {
    expect(() => validateReferenceDataRow(baseRow({ sortOrder: 1.5 }), 'test_table')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('accepts a negative integer sortOrder', () => {
    expect(() => validateReferenceDataRow(baseRow({ sortOrder: -1 }), 'test_table')).not.toThrow()
  })
})

describe('validateDecimalPlaces', () => {
  it('accepts zero', () => {
    expect(() => validateDecimalPlaces(0, 'currencies', 'row_1')).not.toThrow()
  })

  it('accepts a positive integer', () => {
    expect(() => validateDecimalPlaces(3, 'currencies', 'row_1')).not.toThrow()
  })

  it('rejects a negative value', () => {
    expect(() => validateDecimalPlaces(-1, 'currencies', 'row_1')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects a non-integer value', () => {
    expect(() => validateDecimalPlaces(2.5, 'currencies', 'row_1')).toThrow(
      ReferenceDataValidationError
    )
  })

  it('rejects NaN', () => {
    expect(() => validateDecimalPlaces(NaN, 'currencies', 'row_1')).toThrow(
      ReferenceDataValidationError
    )
  })
})

describe('validateUnitCategory', () => {
  it.each(['mass', 'volume', 'count', 'length'])(
    'accepts the approved category "%s"',
    (category) => {
      expect(() => validateUnitCategory(category, 'row_1')).not.toThrow()
    }
  )

  it('rejects an unapproved category', () => {
    expect(() => validateUnitCategory('temperature', 'row_1')).toThrow(ReferenceDataValidationError)
  })

  it('rejects an empty category', () => {
    expect(() => validateUnitCategory('', 'row_1')).toThrow(ReferenceDataValidationError)
  })
})

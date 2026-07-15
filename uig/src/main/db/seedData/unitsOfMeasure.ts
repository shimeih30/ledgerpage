import type { ReferenceDataSeedRow } from './types'

/**
 * The approved unit categories for this slice. No conversion logic or
 * conversion-factor tables exist yet — this is purely an organizational
 * classification for the reference catalog.
 */
export const APPROVED_UNIT_CATEGORIES = ['mass', 'volume', 'count', 'length'] as const
export type UnitCategory = (typeof APPROVED_UNIT_CATEGORIES)[number]

// decimal_places is set explicitly to 3 for every row here, matching the
// column's specified default uniformly — this is not a per-unit
// precision judgment (e.g. "counts are whole numbers"), just an explicit
// application of the one default value this slice was given. Real
// per-unit precision belongs with the unit-conversion work later.
export const unitOfMeasureSeedRows: ReferenceDataSeedRow[] = [
  // Mass
  {
    id: 'uom_kg',
    code: 'kg',
    name: 'Kilogram',
    description: null,
    sortOrder: 0,
    extra: { category: 'mass', decimalPlaces: 3 }
  },
  {
    id: 'uom_g',
    code: 'g',
    name: 'Gram',
    description: null,
    sortOrder: 1,
    extra: { category: 'mass', decimalPlaces: 3 }
  },
  // Volume
  {
    id: 'uom_l',
    code: 'l',
    name: 'Litre',
    description: null,
    sortOrder: 2,
    extra: { category: 'volume', decimalPlaces: 3 }
  },
  {
    id: 'uom_ml',
    code: 'ml',
    name: 'Millilitre',
    description: null,
    sortOrder: 3,
    extra: { category: 'volume', decimalPlaces: 3 }
  },
  // Count
  {
    id: 'uom_ea',
    code: 'ea',
    name: 'Each',
    description: null,
    sortOrder: 4,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  {
    id: 'uom_pc',
    code: 'pc',
    name: 'Piece',
    description: null,
    sortOrder: 5,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  {
    id: 'uom_pack',
    code: 'pack',
    name: 'Pack',
    description: null,
    sortOrder: 6,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  {
    id: 'uom_box',
    code: 'box',
    name: 'Box',
    description: null,
    sortOrder: 7,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  {
    id: 'uom_bottle',
    code: 'bottle',
    name: 'Bottle',
    description: null,
    sortOrder: 8,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  {
    id: 'uom_sachet',
    code: 'sachet',
    name: 'Sachet',
    description: null,
    sortOrder: 9,
    extra: { category: 'count', decimalPlaces: 3 }
  },
  // Length
  {
    id: 'uom_m',
    code: 'm',
    name: 'Metre',
    description: null,
    sortOrder: 10,
    extra: { category: 'length', decimalPlaces: 3 }
  },
  {
    id: 'uom_cm',
    code: 'cm',
    name: 'Centimetre',
    description: null,
    sortOrder: 11,
    extra: { category: 'length', decimalPlaces: 3 }
  }
]

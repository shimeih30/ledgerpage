/**
 * Shape of a static seed row definition, shared across all four
 * reference-data tables. `extra` holds whatever additional columns a
 * specific table has beyond the shared reference-data columns (e.g.
 * currencies' symbol/decimalPlaces) — kept loosely typed here since each
 * table's extra shape differs; seedReferenceData.ts merges it with the
 * shared columns before inserting.
 */
export interface ReferenceDataSeedRow {
  id: string
  code: string
  name: string
  description: string | null
  sortOrder: number
  extra?: Record<string, unknown>
}

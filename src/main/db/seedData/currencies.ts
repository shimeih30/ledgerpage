/**
 * Currency reference-data seed rows.
 */
import type { ReferenceDataSeedRow } from './types'

export const currencySeedRows: ReferenceDataSeedRow[] = [
  {
    id: 'currency_usd',
    code: 'USD',
    name: 'United States Dollar',
    description: null,
    sortOrder: 0,
    extra: { symbol: '$', decimalPlaces: 2 }
  },
  {
    id: 'currency_zar',
    code: 'ZAR',
    name: 'South African Rand',
    description: null,
    sortOrder: 1,
    extra: { symbol: 'R', decimalPlaces: 2 }
  },
  {
    id: 'currency_bwp',
    code: 'BWP',
    name: 'Botswana Pula',
    description: null,
    sortOrder: 2,
    extra: { symbol: 'P', decimalPlaces: 2 }
  },
  {
    id: 'currency_cny',
    code: 'CNY',
    name: 'Chinese Yuan',
    description: null,
    sortOrder: 3,
    extra: { symbol: '¥', decimalPlaces: 2 }
  },
  {
    id: 'currency_zwg',
    code: 'ZWG',
    name: 'Zimbabwe Gold',
    description: 'Zimbabwe Gold local currency',
    sortOrder: 4,
    extra: { symbol: 'ZiG', decimalPlaces: 2 }
  }
]

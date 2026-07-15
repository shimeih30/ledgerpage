import type { ReferenceDataSeedRow } from './types'

export const paymentMethodSeedRows: ReferenceDataSeedRow[] = [
  { id: 'payment_method_cash', code: 'cash', name: 'Cash', description: null, sortOrder: 0 },
  {
    id: 'payment_method_bank_transfer',
    code: 'bank_transfer',
    name: 'Bank Transfer',
    description: null,
    sortOrder: 1
  },
  {
    id: 'payment_method_mobile_money',
    code: 'mobile_money',
    name: 'Mobile Money',
    description: null,
    sortOrder: 2
  },
  { id: 'payment_method_card', code: 'card', name: 'Card', description: null, sortOrder: 3 },
  { id: 'payment_method_credit', code: 'credit', name: 'Credit', description: null, sortOrder: 4 },
  { id: 'payment_method_other', code: 'other', name: 'Other', description: null, sortOrder: 5 }
]

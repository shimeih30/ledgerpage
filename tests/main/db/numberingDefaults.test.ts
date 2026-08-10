import { describe, expect, it } from 'vitest'
import {
  APPROVED_DOCUMENT_TYPE_KEYS,
  APPROVED_NUMBERING_DEFAULTS,
  isApprovedDocumentTypeKey,
  numberingRuleId
} from '../../../src/main/db/numberingDefaults'

describe('APPROVED_NUMBERING_DEFAULTS', () => {
  it('contains exactly eleven entries', () => {
    expect(APPROVED_NUMBERING_DEFAULTS).toHaveLength(11)
  })

  it('matches the frozen specification exactly, plus inventory_lot approved for Slice 15', () => {
    expect(APPROVED_NUMBERING_DEFAULTS).toEqual([
      { documentTypeKey: 'quotation', prefix: 'QT', resetBehavior: 'yearly', paddingLength: 6 },
      { documentTypeKey: 'sales_order', prefix: 'SO', resetBehavior: 'yearly', paddingLength: 6 },
      { documentTypeKey: 'invoice', prefix: 'INV', resetBehavior: 'yearly', paddingLength: 6 },
      { documentTypeKey: 'delivery_note', prefix: 'DN', resetBehavior: 'yearly', paddingLength: 6 },
      {
        documentTypeKey: 'purchase_order',
        prefix: 'PO',
        resetBehavior: 'yearly',
        paddingLength: 6
      },
      {
        documentTypeKey: 'goods_receipt',
        prefix: 'GRN',
        resetBehavior: 'yearly',
        paddingLength: 6
      },
      {
        documentTypeKey: 'production_batch',
        prefix: 'BAT',
        resetBehavior: 'yearly',
        paddingLength: 6
      },
      { documentTypeKey: 'customer', prefix: 'CUS', resetBehavior: 'never', paddingLength: 6 },
      { documentTypeKey: 'supplier', prefix: 'SUP', resetBehavior: 'never', paddingLength: 6 },
      { documentTypeKey: 'product', prefix: 'PRD', resetBehavior: 'never', paddingLength: 6 },
      {
        documentTypeKey: 'inventory_lot',
        prefix: 'LOT',
        resetBehavior: 'never',
        paddingLength: 6
      }
    ])
  })

  it('every entry uses six-digit padding', () => {
    for (const entry of APPROVED_NUMBERING_DEFAULTS) {
      expect(entry.paddingLength).toBe(6)
    }
  })

  it('APPROVED_DOCUMENT_TYPE_KEYS matches the keys in APPROVED_NUMBERING_DEFAULTS exactly', () => {
    expect(APPROVED_NUMBERING_DEFAULTS.map((d) => d.documentTypeKey)).toEqual([
      ...APPROVED_DOCUMENT_TYPE_KEYS
    ])
  })
})

describe('isApprovedDocumentTypeKey', () => {
  it.each([...APPROVED_DOCUMENT_TYPE_KEYS])('accepts the approved key "%s"', (key) => {
    expect(isApprovedDocumentTypeKey(key)).toBe(true)
  })

  it('rejects an unapproved key', () => {
    expect(isApprovedDocumentTypeKey('expense')).toBe(false)
    expect(isApprovedDocumentTypeKey('journal_entry')).toBe(false)
    expect(isApprovedDocumentTypeKey('')).toBe(false)
  })
})

describe('numberingRuleId', () => {
  it('builds a stable, table-prefixed id per document type', () => {
    expect(numberingRuleId('sales_order')).toBe('numbering_rule_sales_order')
    expect(numberingRuleId('customer')).toBe('numbering_rule_customer')
  })
})

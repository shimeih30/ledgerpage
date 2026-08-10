/**
 * Approved document-numbering defaults (frozen by the M1 plan revision
 * before this slice began — see docs/M1_IMPLEMENTATION_PLAN.md, "Freeze
 * document-numbering defaults").
 *
 * This module only exports data — it never touches the database. Slice 5
 * builds and tests the numbering mechanism against disposable fixture
 * rows; Slice 8's first-run transaction is what actually inserts these
 * rows, with a real company_id, once the real company row exists.
 */

export const APPROVED_DOCUMENT_TYPE_KEYS = [
  'quotation',
  'sales_order',
  'invoice',
  'delivery_note',
  'purchase_order',
  'goods_receipt',
  'production_batch',
  'customer',
  'supplier',
  'product',
  'inventory_lot'
] as const

export type DocumentTypeKey = (typeof APPROVED_DOCUMENT_TYPE_KEYS)[number]

export type ResetBehavior = 'never' | 'yearly'

export interface NumberingRuleDefault {
  documentTypeKey: DocumentTypeKey
  prefix: string
  resetBehavior: ResetBehavior
  paddingLength: number
}

/**
 * The 11 approved defaults, in the order given in the frozen plan (10
 * originally, plus `inventory_lot` approved for Slice 15). Every entry
 * uses 6-digit padding, per the approved rule that padding is uniform
 * across all document types (including never-reset ones — CUS-000001,
 * not CUS-00001).
 */
export const APPROVED_NUMBERING_DEFAULTS: readonly NumberingRuleDefault[] = [
  { documentTypeKey: 'quotation', prefix: 'QT', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'sales_order', prefix: 'SO', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'invoice', prefix: 'INV', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'delivery_note', prefix: 'DN', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'purchase_order', prefix: 'PO', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'goods_receipt', prefix: 'GRN', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'production_batch', prefix: 'BAT', resetBehavior: 'yearly', paddingLength: 6 },
  { documentTypeKey: 'customer', prefix: 'CUS', resetBehavior: 'never', paddingLength: 6 },
  { documentTypeKey: 'supplier', prefix: 'SUP', resetBehavior: 'never', paddingLength: 6 },
  { documentTypeKey: 'product', prefix: 'PRD', resetBehavior: 'never', paddingLength: 6 },
  { documentTypeKey: 'inventory_lot', prefix: 'LOT', resetBehavior: 'never', paddingLength: 6 }
]

export function isApprovedDocumentTypeKey(value: string): value is DocumentTypeKey {
  return (APPROVED_DOCUMENT_TYPE_KEYS as readonly string[]).includes(value)
}

/**
 * Builds the stable numbering_rules.id for a given document type,
 * matching the convention used elsewhere in this codebase
 * (table-prefixed slugs — see Slice 4's seed data).
 */
export function numberingRuleId(documentTypeKey: DocumentTypeKey): string {
  return `numbering_rule_${documentTypeKey}`
}

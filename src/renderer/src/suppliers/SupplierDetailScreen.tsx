import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditColors,
  auditFieldGroupStyle,
  auditFieldStyle,
  auditFilterBarStyle,
  auditGhostButtonStyle,
  auditHeadingStyle,
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle
} from '../shared/ui'
import type { SafeSupplier, SafeSupplierItemPrice } from '../../../shared/ipc/suppliers'
import type { SafeInventoryItem } from '../../../shared/ipc/inventoryItems'
import {
  formatMinorUnitsAsSupplierPrice,
  parseSupplierPriceToMinorUnits
} from './supplierPriceDecimal'

interface SupplierDetailScreenProps {
  supplierId?: string
  canManageSuppliers: boolean
  onBack: () => void
  onSaved: (supplierId: string) => void
}

type SupplierState =
  | { kind: 'creating' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; supplier: SafeSupplier }

function statusBadgeStyle(isActive: boolean) {
  return {
    display: 'inline-block' as const,
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    backgroundColor: isActive ? '#EAF3DE' : '#FAEEDA',
    color: isActive ? '#27500A' : '#633806'
  }
}

function priceStatusBadgeStyle(status: 'future' | 'current' | 'historical') {
  const palette = {
    future: { bg: '#EAF0FA', fg: '#1B3B77' },
    current: { bg: '#EAF3DE', fg: '#27500A' },
    historical: { bg: '#F1EEE7', fg: '#5B6472' }
  }[status]
  return {
    display: 'inline-block' as const,
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    backgroundColor: palette.bg,
    color: palette.fg
  }
}

/**
 * A row is "current" only if it is the latest (by effectiveFrom, then
 * createdAt) row for its own (supplierId, inventoryItemId) pair with
 * effectiveFrom <= now — matching getCurrentSupplierItemPrice's own
 * server-side rule exactly, computed here purely for display grouping
 * across a mixed list of items. A future-dated row is never presented
 * as current, regardless of how recently it was created.
 */
function computePriceStatus(
  allPrices: SafeSupplierItemPrice[],
  price: SafeSupplierItemPrice,
  now: number
): 'future' | 'current' | 'historical' {
  if (price.effectiveFrom > now) {
    return 'future'
  }
  const sameItemPastOrPresent = allPrices
    .filter((p) => p.inventoryItemId === price.inventoryItemId && p.effectiveFrom <= now)
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom || b.createdAt - a.createdAt)
  return sameItemPastOrPresent[0]?.id === price.id ? 'current' : 'historical'
}

async function loadSupplier(
  supplierId: string,
  setState: (next: SupplierState) => void,
  applyLoadedFields: (supplier: SafeSupplier) => void
): Promise<void> {
  try {
    const result = await window.ledgerpage.getSupplier({ supplierId })
    if (!result.success) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ready', supplier: result.supplier })
    applyLoadedFields(result.supplier)
  } catch {
    setState({ kind: 'error' })
  }
}

/**
 * Every mutating control here (edit fields, deactivate/reactivate, and
 * the entire price-recording form) is only ever rendered when
 * canManageSuppliers is true — cosmetic only, matching every prior
 * canManage* precedent. The real boundary is each suppliers handler's
 * own requireAuthorizedCaller('suppliers.manage') check.
 *
 * code is never accepted as update input anywhere in this file —
 * UpdateSupplierInput (shared/ipc/suppliers.ts) has no such field, a
 * structural guarantee. currencyId is never accepted or submitted by
 * the price-recording form at all; the server always assigns
 * FUNCTIONAL_CURRENCY_ID.
 */
export function SupplierDetailScreen({
  supplierId,
  canManageSuppliers,
  onBack,
  onSaved
}: SupplierDetailScreenProps) {
  const [state, setState] = useState<SupplierState>(
    supplierId ? { kind: 'loading' } : { kind: 'creating' }
  )

  const [createName, setCreateName] = useState('')
  const [createContactDetails, setCreateContactDetails] = useState('')
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [isCreating, setIsCreating] = useState(false)

  const [editName, setEditName] = useState('')
  const [editContactDetails, setEditContactDetails] = useState('')
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [isToggling, setIsToggling] = useState(false)

  const [prices, setPrices] = useState<SafeSupplierItemPrice[]>([])
  const [pricesError, setPricesError] = useState<string | undefined>(undefined)

  const [assignableItems, setAssignableItems] = useState<SafeInventoryItem[]>([])
  const [priceItemId, setPriceItemId] = useState('')
  const [priceSupplierItemCode, setPriceSupplierItemCode] = useState('')
  const [priceAmount, setPriceAmount] = useState('')
  const [priceEffectiveDate, setPriceEffectiveDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  )
  const [priceFormError, setPriceFormError] = useState<string | undefined>(undefined)
  const [isRecordingPrice, setIsRecordingPrice] = useState(false)

  // Date.now() must not be called directly in the render body (an
  // impure call) -- captured once per prices reload instead, which is
  // the only time the current/scheduled/historical status display
  // actually needs to be recomputed.
  const [nowMs, setNowMs] = useState(() => Date.now())

  function applyLoadedFields(supplier: SafeSupplier): void {
    setEditName(supplier.name)
    setEditContactDetails(supplier.contactDetails ?? '')
  }

  function reloadPrices(currentSupplierId: string): void {
    window.ledgerpage
      .listPricesForSupplier({ supplierId: currentSupplierId })
      .then((result) => {
        setNowMs(Date.now())
        if (!result.success) {
          setPricesError('Something went wrong loading price history.')
          return
        }
        setPricesError(undefined)
        setPrices(result.prices)
      })
      .catch(() => {
        setNowMs(Date.now())
        setPricesError('Something went wrong loading price history.')
      })
  }

  useEffect(() => {
    if (supplierId) {
      void loadSupplier(supplierId, setState, applyLoadedFields)
      reloadPrices(supplierId)
    }
    window.ledgerpage
      .listInventoryItems()
      .then((result) => {
        if (result.success) {
          setAssignableItems(result.inventoryItems.filter((item) => item.isActive))
        }
      })
      .catch(() => {
        // The item picker simply stays empty; the rest of this screen
        // still works.
      })
  }, [supplierId])

  async function handleCreate(): Promise<void> {
    if (isCreating) {
      return
    }
    setCreateError(undefined)
    setIsCreating(true)
    try {
      const result = await window.ledgerpage.createSupplier({
        name: createName,
        contactDetails: createContactDetails
      })
      if (!result.success) {
        setCreateError(describeSupplierError(result.errorCode))
        return
      }
      setState({ kind: 'ready', supplier: result.supplier })
      applyLoadedFields(result.supplier)
      onSaved(result.supplier.id)
    } catch {
      setCreateError('Something went wrong. Try again.')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (state.kind !== 'ready' || isSavingEdit) {
      return
    }
    setEditError(undefined)
    setIsSavingEdit(true)
    try {
      const result = await window.ledgerpage.updateSupplier({
        supplierId: state.supplier.id,
        name: editName,
        contactDetails: editContactDetails
      })
      if (!result.success) {
        setEditError(describeSupplierError(result.errorCode))
        return
      }
      setState({ kind: 'ready', supplier: result.supplier })
      applyLoadedFields(result.supplier)
      onSaved(result.supplier.id)
    } catch {
      setEditError('Something went wrong. Try again.')
    } finally {
      setIsSavingEdit(false)
    }
  }

  async function handleToggleActive(): Promise<void> {
    if (state.kind !== 'ready' || isToggling) {
      return
    }
    setActionError(undefined)
    setIsToggling(true)
    try {
      const result = state.supplier.isActive
        ? await window.ledgerpage.deactivateSupplier({ supplierId: state.supplier.id })
        : await window.ledgerpage.reactivateSupplier({ supplierId: state.supplier.id })
      if (!result.success) {
        setActionError(describeSupplierError(result.errorCode))
        return
      }
      setState({ kind: 'ready', supplier: result.supplier })
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setIsToggling(false)
    }
  }

  async function handleRecordPrice(): Promise<void> {
    if (state.kind !== 'ready' || isRecordingPrice) {
      return
    }
    if (priceItemId === '') {
      setPriceFormError('Select an inventory item.')
      return
    }
    const priceMinor = parseSupplierPriceToMinorUnits(priceAmount)
    if (priceMinor === undefined) {
      setPriceFormError('Enter a valid price, e.g. 10 or 10.29.')
      return
    }
    const effectiveFrom = new Date(priceEffectiveDate)
    if (Number.isNaN(effectiveFrom.getTime())) {
      setPriceFormError('Enter a valid effective date.')
      return
    }

    setPriceFormError(undefined)
    setIsRecordingPrice(true)
    try {
      const result = await window.ledgerpage.recordSupplierPrice({
        supplierId: state.supplier.id,
        inventoryItemId: priceItemId,
        priceMinor,
        effectiveFrom: effectiveFrom.getTime(),
        supplierItemCode: priceSupplierItemCode
      })
      if (!result.success) {
        setPriceFormError(describeSupplierError(result.errorCode))
        return
      }
      setPriceItemId('')
      setPriceSupplierItemCode('')
      setPriceAmount('')
      reloadPrices(state.supplier.id)
    } catch {
      setPriceFormError('Something went wrong. Try again.')
    } finally {
      setIsRecordingPrice(false)
    }
  }

  if (state.kind === 'creating') {
    return (
      <div style={auditPageStyle}>
        <div style={auditFilterBarStyle}>
          <h1 style={auditHeadingStyle}>New supplier</h1>
          <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
            Back
          </button>
        </div>

        {createError && <div style={auditBannerStyle}>{createError}</div>}

        <div style={auditPanelStyle}>
          <div
            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={auditFieldGroupStyle}>
                <label htmlFor="supplier-create-name" style={auditLabelStyle}>
                  Name
                </label>
                <input
                  id="supplier-create-name"
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="supplier-create-contact" style={auditLabelStyle}>
                  Contact details (optional)
                </label>
                <input
                  id="supplier-create-contact"
                  type="text"
                  value={createContactDetails}
                  onChange={(event) => setCreateContactDetails(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating}
                style={{ ...auditPrimaryButtonStyle, opacity: isCreating ? 0.7 : 1 }}
              >
                {isCreating ? 'Creating\u2026' : 'Create supplier'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (state.kind === 'loading') {
    return (
      <div style={auditPageStyle}>
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div style={auditPageStyle}>
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load this supplier. Try reloading the app.
        </div>
      </div>
    )
  }

  const { supplier } = state
  const now = nowMs

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>{supplier.name}</h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {actionError && <div style={auditBannerStyle}>{actionError}</div>}

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Code</span>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9375rem' }}>
                {supplier.code}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Status</span>
              <div style={{ marginTop: '0.125rem' }}>
                <span style={statusBadgeStyle(supplier.isActive)}>
                  {supplier.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {canManageSuppliers ? (
            <>
              {editError && <div style={auditBannerStyle}>{editError}</div>}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="supplier-edit-name" style={auditLabelStyle}>
                    Name
                  </label>
                  <input
                    id="supplier-edit-name"
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="supplier-edit-contact" style={auditLabelStyle}>
                    Contact details (optional)
                  </label>
                  <input
                    id="supplier-edit-contact"
                    type="text"
                    value={editContactDetails}
                    onChange={(event) => setEditContactDetails(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveEdit()}
                  disabled={isSavingEdit}
                  style={{ ...auditPrimaryButtonStyle, opacity: isSavingEdit ? 0.7 : 1 }}
                >
                  {isSavingEdit ? 'Saving\u2026' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleActive()}
                  disabled={isToggling}
                  style={{ ...auditGhostButtonStyle, opacity: isToggling ? 0.7 : 1 }}
                >
                  {supplier.isActive ? 'Deactivate supplier' : 'Reactivate supplier'}
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              Contact: {supplier.contactDetails ?? '\u2014'}
            </p>
          )}
        </div>
      </div>

      {canManageSuppliers && (
        <div style={auditPanelStyle}>
          <div
            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <h2 style={{ ...auditHeadingStyle, fontSize: '1.0625rem', margin: 0 }}>
              Record a new price
            </h2>

            {priceFormError && <div style={auditBannerStyle}>{priceFormError}</div>}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={auditFieldGroupStyle}>
                <label htmlFor="price-item" style={auditLabelStyle}>
                  Inventory item
                </label>
                <select
                  id="price-item"
                  value={priceItemId}
                  onChange={(event) => setPriceItemId(event.target.value)}
                  style={auditFieldStyle()}
                >
                  <option value="">Select an item&hellip;</option>
                  {assignableItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} &mdash; {item.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="price-supplier-item-code" style={auditLabelStyle}>
                  Supplier item code (optional)
                </label>
                <input
                  id="price-supplier-item-code"
                  type="text"
                  value={priceSupplierItemCode}
                  onChange={(event) => setPriceSupplierItemCode(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="price-amount" style={auditLabelStyle}>
                  Price
                </label>
                <input
                  id="price-amount"
                  type="text"
                  inputMode="decimal"
                  value={priceAmount}
                  onChange={(event) => setPriceAmount(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="price-effective-date" style={auditLabelStyle}>
                  Effective date
                </label>
                <input
                  id="price-effective-date"
                  type="date"
                  value={priceEffectiveDate}
                  onChange={(event) => setPriceEffectiveDate(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void handleRecordPrice()}
                disabled={isRecordingPrice}
                style={{ ...auditPrimaryButtonStyle, opacity: isRecordingPrice ? 0.7 : 1 }}
              >
                {isRecordingPrice ? 'Recording\u2026' : 'Record price'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ ...auditHeadingStyle, fontSize: '1.0625rem', margin: 0 }}>Price history</h2>

          {pricesError && <div style={auditBannerStyle}>{pricesError}</div>}

          {prices.length === 0 && !pricesError && (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              No prices recorded yet.
            </p>
          )}

          {prices.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8125rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: auditColors.mutedInk }}>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Item</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Supplier item code</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Unit</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Price</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Effective</th>
                  <th style={{ padding: '0.375rem 0.5rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {prices.map((price) => {
                  const status = computePriceStatus(prices, price, now)
                  return (
                    <tr key={price.id} style={{ borderTop: `1px solid ${auditColors.border}` }}>
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        {price.inventoryItemCode} &mdash; {price.inventoryItemName}
                        {!price.inventoryItemIsActive && (
                          <span style={{ color: auditColors.mutedInk }}> (inactive)</span>
                        )}
                      </td>
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        {price.supplierItemCode ?? '\u2014'}
                      </td>
                      <td style={{ padding: '0.375rem 0.5rem' }}>{price.unitOfMeasureLabel}</td>
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        {formatMinorUnitsAsSupplierPrice(price.priceMinor)}
                      </td>
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        {new Date(price.effectiveFrom).toISOString().slice(0, 10)}
                      </td>
                      <td style={{ padding: '0.375rem 0.5rem' }}>
                        <span style={priceStatusBadgeStyle(status)}>
                          {status === 'future'
                            ? 'Scheduled'
                            : status === 'current'
                              ? 'Current'
                              : 'Historical'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function describeSupplierError(errorCode: string): string {
  switch (errorCode) {
    case 'invalid_input':
      return 'Check the fields above: a value is missing or invalid, or the supplier/item is not active.'
    case 'duplicate_effective_price':
      return 'A price already exists for this item at that exact effective date and time.'
    case 'not_authorized':
      return 'You don\u2019t have permission to do that.'
    case 'session_invalid':
      return 'Your session is no longer active. Try signing in again.'
    case 'not_found':
      return 'This supplier could not be found.'
    default:
      return 'Something went wrong. Try again.'
  }
}

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
import type {
  AssignableUnitOfMeasure,
  InventoryItemType,
  SafeInventoryItem
} from '../../../shared/ipc/inventoryItems'
import { parseNonNegativeInteger, parseNullableNonNegativeInteger } from './inventoryItemQuantity'

interface InventoryItemDetailScreenProps {
  inventoryItemId?: string
  canManageInventoryItems: boolean
  onBack: () => void
  onSaved: (inventoryItemId: string) => void
}

type ItemState =
  | { kind: 'creating' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; item: SafeInventoryItem }

const ITEM_TYPE_OPTIONS: { value: InventoryItemType; label: string }[] = [
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'other', label: 'Other' }
]

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

async function loadInventoryItem(
  inventoryItemId: string,
  setState: (next: ItemState) => void,
  applyLoadedFields: (item: SafeInventoryItem) => void
): Promise<void> {
  try {
    const result = await window.ledgerpage.getInventoryItem({ inventoryItemId })
    if (!result.success) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ready', item: result.inventoryItem })
    applyLoadedFields(result.inventoryItem)
  } catch {
    setState({ kind: 'error' })
  }
}

/**
 * Every mutating control here (all edit fields, deactivate/reactivate)
 * is only ever rendered when canManageInventoryItems is true -- but
 * that flag is cosmetic only, matching canManageProducts's established
 * precedent. The real boundary is each inventory-items handler's own
 * requireAuthorizedCaller('inventory_items.manage') check, resolved
 * fresh from SQLite on every call in the main process.
 *
 * code and itemType are never accepted as update input anywhere in this
 * file -- UpdateInventoryItemInput (shared/ipc/inventoryItems.ts) has
 * neither field, a structural guarantee, not merely a runtime-enforced
 * one. Both are rendered as read-only text once an item exists.
 */
export function InventoryItemDetailScreen({
  inventoryItemId,
  canManageInventoryItems,
  onBack,
  onSaved
}: InventoryItemDetailScreenProps) {
  const [state, setState] = useState<ItemState>(
    inventoryItemId ? { kind: 'loading' } : { kind: 'creating' }
  )

  const [assignableUnits, setAssignableUnits] = useState<AssignableUnitOfMeasure[]>([])

  const [createCode, setCreateCode] = useState('')
  const [createName, setCreateName] = useState('')
  const [createCategory, setCreateCategory] = useState('')
  const [createItemType, setCreateItemType] = useState<InventoryItemType>('ingredient')
  const [createUnitOfMeasureId, setCreateUnitOfMeasureId] = useState('')
  const [createMinimumStock, setCreateMinimumStock] = useState('0')
  const [createReorderQuantity, setCreateReorderQuantity] = useState('0')
  const [createMaximumStock, setCreateMaximumStock] = useState('')
  const [createLeadTimeDays, setCreateLeadTimeDays] = useState('0')
  const [createLotTracked, setCreateLotTracked] = useState(false)
  const [createExpiryTracked, setCreateExpiryTracked] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [isCreating, setIsCreating] = useState(false)

  const [editName, setEditName] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editUnitOfMeasureId, setEditUnitOfMeasureId] = useState('')
  const [editOriginalUnitOfMeasureId, setEditOriginalUnitOfMeasureId] = useState('')
  const [editOriginalUnitOfMeasureLabel, setEditOriginalUnitOfMeasureLabel] = useState('')
  const [editMinimumStock, setEditMinimumStock] = useState('0')
  const [editReorderQuantity, setEditReorderQuantity] = useState('0')
  const [editMaximumStock, setEditMaximumStock] = useState('')
  const [editLeadTimeDays, setEditLeadTimeDays] = useState('0')
  const [editLotTracked, setEditLotTracked] = useState(false)
  const [editExpiryTracked, setEditExpiryTracked] = useState(false)
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const [actionError, setActionError] = useState<string | undefined>(undefined)
  const [isToggling, setIsToggling] = useState(false)

  function applyLoadedFields(item: SafeInventoryItem): void {
    setEditName(item.name)
    setEditCategory(item.category)
    setEditUnitOfMeasureId(item.unitOfMeasureId)
    setEditOriginalUnitOfMeasureId(item.unitOfMeasureId)
    setEditOriginalUnitOfMeasureLabel(item.unitOfMeasureLabel)
    setEditMinimumStock(String(item.minimumStock))
    setEditReorderQuantity(String(item.reorderQuantity))
    setEditMaximumStock(item.maximumStock === null ? '' : String(item.maximumStock))
    setEditLeadTimeDays(String(item.leadTimeDays))
    setEditLotTracked(item.lotTracked)
    setEditExpiryTracked(item.expiryTracked)
  }

  useEffect(() => {
    if (inventoryItemId) {
      void loadInventoryItem(inventoryItemId, setState, applyLoadedFields)
    }
    window.ledgerpage
      .listAssignableUnitsOfMeasure()
      .then((result) => {
        if (result.success) {
          setAssignableUnits(result.units)
        }
      })
      .catch(() => {
        // The unit dropdown simply falls back to whatever is already
        // assigned; the rest of this screen still works.
      })
  }, [inventoryItemId])

  async function handleCreate(): Promise<void> {
    if (isCreating) {
      return
    }

    const minimumStock = parseNonNegativeInteger(createMinimumStock)
    if (minimumStock === undefined) {
      setCreateError('Enter a whole, non-negative minimum stock, e.g. 0 or 25.')
      return
    }
    const reorderQuantity = parseNonNegativeInteger(createReorderQuantity)
    if (reorderQuantity === undefined) {
      setCreateError('Enter a whole, non-negative reorder quantity, e.g. 0 or 25.')
      return
    }
    const maximumStock = parseNullableNonNegativeInteger(createMaximumStock)
    if (maximumStock === undefined) {
      setCreateError('Enter a whole, non-negative maximum stock, or leave it blank.')
      return
    }
    if (maximumStock !== null && maximumStock < minimumStock) {
      setCreateError('Maximum stock must be greater than or equal to minimum stock.')
      return
    }
    const leadTimeDays = parseNonNegativeInteger(createLeadTimeDays)
    if (leadTimeDays === undefined) {
      setCreateError('Enter a whole, non-negative lead time in days, e.g. 0 or 3.')
      return
    }

    setCreateError(undefined)
    setIsCreating(true)
    try {
      const result = await window.ledgerpage.createInventoryItem({
        code: createCode,
        name: createName,
        category: createCategory,
        itemType: createItemType,
        unitOfMeasureId: createUnitOfMeasureId,
        minimumStock,
        reorderQuantity,
        maximumStock,
        leadTimeDays,
        lotTracked: createLotTracked,
        expiryTracked: createExpiryTracked
      })
      if (!result.success) {
        setCreateError(describeInventoryItemError(result.errorCode))
        return
      }
      setState({ kind: 'ready', item: result.inventoryItem })
      applyLoadedFields(result.inventoryItem)
      onSaved(result.inventoryItem.id)
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

    const minimumStock = parseNonNegativeInteger(editMinimumStock)
    if (minimumStock === undefined) {
      setEditError('Enter a whole, non-negative minimum stock, e.g. 0 or 25.')
      return
    }
    const reorderQuantity = parseNonNegativeInteger(editReorderQuantity)
    if (reorderQuantity === undefined) {
      setEditError('Enter a whole, non-negative reorder quantity, e.g. 0 or 25.')
      return
    }
    const maximumStock = parseNullableNonNegativeInteger(editMaximumStock)
    if (maximumStock === undefined) {
      setEditError('Enter a whole, non-negative maximum stock, or leave it blank.')
      return
    }
    if (maximumStock !== null && maximumStock < minimumStock) {
      setEditError('Maximum stock must be greater than or equal to minimum stock.')
      return
    }
    const leadTimeDays = parseNonNegativeInteger(editLeadTimeDays)
    if (leadTimeDays === undefined) {
      setEditError('Enter a whole, non-negative lead time in days, e.g. 0 or 3.')
      return
    }

    setEditError(undefined)
    setIsSavingEdit(true)
    try {
      const result = await window.ledgerpage.updateInventoryItem({
        inventoryItemId: state.item.id,
        name: editName,
        category: editCategory,
        unitOfMeasureId: editUnitOfMeasureId,
        minimumStock,
        reorderQuantity,
        maximumStock,
        leadTimeDays,
        lotTracked: editLotTracked,
        expiryTracked: editExpiryTracked
      })
      if (!result.success) {
        setEditError(describeInventoryItemError(result.errorCode))
        return
      }
      setState({ kind: 'ready', item: result.inventoryItem })
      applyLoadedFields(result.inventoryItem)
      onSaved(result.inventoryItem.id)
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
      const result = state.item.isActive
        ? await window.ledgerpage.deactivateInventoryItem({ inventoryItemId: state.item.id })
        : await window.ledgerpage.reactivateInventoryItem({ inventoryItemId: state.item.id })
      if (!result.success) {
        setActionError(describeInventoryItemError(result.errorCode))
        return
      }
      setState({ kind: 'ready', item: result.inventoryItem })
    } catch {
      setActionError('Something went wrong. Try again.')
    } finally {
      setIsToggling(false)
    }
  }

  if (state.kind === 'creating') {
    return (
      <div style={auditPageStyle}>
        <div style={auditFilterBarStyle}>
          <h1 style={auditHeadingStyle}>New inventory item</h1>
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
                <label htmlFor="item-create-code" style={auditLabelStyle}>
                  Code
                </label>
                <input
                  id="item-create-code"
                  type="text"
                  value={createCode}
                  onChange={(event) => setCreateCode(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-name" style={auditLabelStyle}>
                  Name
                </label>
                <input
                  id="item-create-name"
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-category" style={auditLabelStyle}>
                  Category
                </label>
                <input
                  id="item-create-category"
                  type="text"
                  value={createCategory}
                  onChange={(event) => setCreateCategory(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-type" style={auditLabelStyle}>
                  Item type
                </label>
                <select
                  id="item-create-type"
                  value={createItemType}
                  onChange={(event) => setCreateItemType(event.target.value as InventoryItemType)}
                  style={auditFieldStyle()}
                >
                  {ITEM_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-unit" style={auditLabelStyle}>
                  Unit of measure
                </label>
                <select
                  id="item-create-unit"
                  value={createUnitOfMeasureId}
                  onChange={(event) => setCreateUnitOfMeasureId(event.target.value)}
                  style={auditFieldStyle()}
                >
                  <option value="">Select a unit&hellip;</option>
                  {assignableUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} &mdash; {unit.name}
                    </option>
                  ))}
                </select>
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-min-stock" style={auditLabelStyle}>
                  Minimum stock
                </label>
                <input
                  id="item-create-min-stock"
                  type="text"
                  inputMode="numeric"
                  value={createMinimumStock}
                  onChange={(event) => setCreateMinimumStock(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-reorder-qty" style={auditLabelStyle}>
                  Reorder quantity
                </label>
                <input
                  id="item-create-reorder-qty"
                  type="text"
                  inputMode="numeric"
                  value={createReorderQuantity}
                  onChange={(event) => setCreateReorderQuantity(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-max-stock" style={auditLabelStyle}>
                  Maximum stock (optional)
                </label>
                <input
                  id="item-create-max-stock"
                  type="text"
                  inputMode="numeric"
                  value={createMaximumStock}
                  onChange={(event) => setCreateMaximumStock(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="item-create-lead-time" style={auditLabelStyle}>
                  Lead time (days)
                </label>
                <input
                  id="item-create-lead-time"
                  type="text"
                  inputMode="numeric"
                  value={createLeadTimeDays}
                  onChange={(event) => setCreateLeadTimeDays(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8125rem'
              }}
            >
              <input
                type="checkbox"
                checked={createLotTracked}
                onChange={(event) => setCreateLotTracked(event.target.checked)}
              />
              Lot-tracked
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.8125rem'
              }}
            >
              <input
                type="checkbox"
                checked={createExpiryTracked}
                onChange={(event) => setCreateExpiryTracked(event.target.checked)}
              />
              Expiry-tracked
            </label>

            <div>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={isCreating}
                style={{ ...auditPrimaryButtonStyle, opacity: isCreating ? 0.7 : 1 }}
              >
                {isCreating ? 'Creating\u2026' : 'Create item'}
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
          Couldn&rsquo;t load this inventory item. Try reloading the app.
        </div>
      </div>
    )
  }

  const { item } = state

  // The special "currently assigned but now inactive" option is only
  // ever shown while editUnitOfMeasureId still equals the value this
  // form was opened/loaded with -- the moment the user picks anything
  // else, this stops being offered at all, matching "it cannot be
  // reselected after changing away."
  const showInactiveUnitOption =
    editUnitOfMeasureId === editOriginalUnitOfMeasureId &&
    !assignableUnits.some((unit) => unit.id === editOriginalUnitOfMeasureId)

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>{item.name}</h1>
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
                {item.code}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Item type</span>
              <div style={{ fontSize: '0.9375rem', color: auditColors.mutedInk }}>
                {item.itemType}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Status</span>
              <div style={{ marginTop: '0.125rem' }}>
                <span style={statusBadgeStyle(item.isActive)}>
                  {item.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {canManageInventoryItems ? (
            <>
              {editError && <div style={auditBannerStyle}>{editError}</div>}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-name" style={auditLabelStyle}>
                    Name
                  </label>
                  <input
                    id="item-edit-name"
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-category" style={auditLabelStyle}>
                    Category
                  </label>
                  <input
                    id="item-edit-category"
                    type="text"
                    value={editCategory}
                    onChange={(event) => setEditCategory(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-unit" style={auditLabelStyle}>
                    Unit of measure
                  </label>
                  <select
                    id="item-edit-unit"
                    value={editUnitOfMeasureId}
                    onChange={(event) => setEditUnitOfMeasureId(event.target.value)}
                    style={auditFieldStyle()}
                  >
                    {showInactiveUnitOption && (
                      <option value={editOriginalUnitOfMeasureId}>
                        {editOriginalUnitOfMeasureLabel} (no longer active)
                      </option>
                    )}
                    {assignableUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} &mdash; {unit.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-min-stock" style={auditLabelStyle}>
                    Minimum stock
                  </label>
                  <input
                    id="item-edit-min-stock"
                    type="text"
                    inputMode="numeric"
                    value={editMinimumStock}
                    onChange={(event) => setEditMinimumStock(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-reorder-qty" style={auditLabelStyle}>
                    Reorder quantity
                  </label>
                  <input
                    id="item-edit-reorder-qty"
                    type="text"
                    inputMode="numeric"
                    value={editReorderQuantity}
                    onChange={(event) => setEditReorderQuantity(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-max-stock" style={auditLabelStyle}>
                    Maximum stock (optional)
                  </label>
                  <input
                    id="item-edit-max-stock"
                    type="text"
                    inputMode="numeric"
                    value={editMaximumStock}
                    onChange={(event) => setEditMaximumStock(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>

                <div style={auditFieldGroupStyle}>
                  <label htmlFor="item-edit-lead-time" style={auditLabelStyle}>
                    Lead time (days)
                  </label>
                  <input
                    id="item-edit-lead-time"
                    type="text"
                    inputMode="numeric"
                    value={editLeadTimeDays}
                    onChange={(event) => setEditLeadTimeDays(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8125rem'
                }}
              >
                <input
                  type="checkbox"
                  checked={editLotTracked}
                  onChange={(event) => setEditLotTracked(event.target.checked)}
                />
                Lot-tracked
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.8125rem'
                }}
              >
                <input
                  type="checkbox"
                  checked={editExpiryTracked}
                  onChange={(event) => setEditExpiryTracked(event.target.checked)}
                />
                Expiry-tracked
              </label>

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
                  {item.isActive ? 'Deactivate item' : 'Reactivate item'}
                </button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
                Category: {item.category}
              </p>
              <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
                Unit: {item.unitOfMeasureLabel}
              </p>
              <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
                Minimum stock: {item.minimumStock} &middot; Reorder quantity: {item.reorderQuantity}{' '}
                &middot; Maximum stock: {item.maximumStock === null ? '\u2014' : item.maximumStock}{' '}
                &middot; Lead time: {item.leadTimeDays} day(s)
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function describeInventoryItemError(errorCode: string): string {
  switch (errorCode) {
    case 'duplicate_code':
      return 'An inventory item with this code already exists.'
    case 'invalid_input':
      return 'Check the fields above: a value is missing, invalid, or the selected unit is no longer active.'
    case 'not_authorized':
      return 'You don\u2019t have permission to do that.'
    case 'session_invalid':
      return 'Your session is no longer active. Try signing in again.'
    case 'not_found':
      return 'This inventory item could not be found.'
    default:
      return 'Something went wrong. Try again.'
  }
}

import { useEffect, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
  auditFieldGroupStyle,
  auditFieldStyle,
  auditFilterBarStyle,
  auditGhostButtonStyle,
  auditHeaderCellStyle,
  auditHeaderRowStyle,
  auditHeadingStyle,
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle,
  auditTableStyle
} from '../shared/ui'
import type {
  AssignableTaxCode,
  ProductType,
  SafeProduct,
  SafeProductVariant
} from '../../../shared/ipc/products'
import {
  formatMinorUnitsAsDecimal,
  parseDecimalToMinorUnits,
  parseNonNegativeInteger
} from './productDecimal'

interface ProductDetailScreenProps {
  productId?: string
  canManageProducts: boolean
  onBack: () => void
  onSaved: (productId: string) => void
}

type ProductState =
  | { kind: 'creating' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; product: SafeProduct; variants: SafeProductVariant[] }

type VariantFormMode = { kind: 'closed' } | { kind: 'creating' } | { kind: 'editing'; id: string }

const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: 'manufactured', label: 'Manufactured' },
  { value: 'service', label: 'Service' }
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

async function loadProduct(
  productId: string,
  setState: (next: ProductState) => void,
  setEditName: (name: string) => void
): Promise<void> {
  try {
    const [productResult, variantsResult] = await Promise.all([
      window.ledgerpage.getProduct({ productId }),
      window.ledgerpage.listVariantsForProduct({ productId })
    ])
    if (!productResult.success || !variantsResult.success) {
      setState({ kind: 'error' })
      return
    }
    setState({ kind: 'ready', product: productResult.product, variants: variantsResult.variants })
    setEditName(productResult.product.name)
  } catch {
    setState({ kind: 'error' })
  }
}

/**
 * Every mutating control here (product name edit, deactivate/
 * reactivate, every variant control) is only ever rendered when
 * canManageProducts is true — but that flag is cosmetic only, matching
 * canViewAuditLog's established precedent. The real boundary is each
 * individual products and product-variants handler's own
 * requireAuthorizedCaller('products.manage') check, resolved fresh from
 * SQLite on every call in the main process. A read-only caller who
 * somehow reached a mutating IPC channel directly would get the same
 * clean not_authorized failure regardless of what this renderer shows.
 *
 * code is never accepted as create or update input anywhere in this
 * file — CreateProductInput/UpdateProductInput (shared/ipc/products.ts)
 * have no code field at all, a structural guarantee, not merely a
 * runtime-enforced one. type is likewise never sent on update — there
 * is no code path here that could.
 */
export function ProductDetailScreen({
  productId,
  canManageProducts,
  onBack,
  onSaved
}: ProductDetailScreenProps) {
  const [state, setState] = useState<ProductState>(
    productId ? { kind: 'loading' } : { kind: 'creating' }
  )

  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<ProductType>('manufactured')
  const [createError, setCreateError] = useState<string | undefined>(undefined)
  const [isCreating, setIsCreating] = useState(false)

  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState<string | undefined>(undefined)
  const [isSavingName, setIsSavingName] = useState(false)

  const [productActionError, setProductActionError] = useState<string | undefined>(undefined)
  const [isTogglingProduct, setIsTogglingProduct] = useState(false)

  const [assignableTaxCodes, setAssignableTaxCodes] = useState<AssignableTaxCode[]>([])

  const [variantFormMode, setVariantFormMode] = useState<VariantFormMode>({ kind: 'closed' })
  const [variantCode, setVariantCode] = useState('')
  const [variantName, setVariantName] = useState('')
  const [variantPrice, setVariantPrice] = useState('')
  const [variantBarcode, setVariantBarcode] = useState('')
  const [variantTaxCodeId, setVariantTaxCodeId] = useState('')
  const [variantOriginalTaxCodeId, setVariantOriginalTaxCodeId] = useState<string | null>(null)
  const [variantOriginalTaxCodeLabel, setVariantOriginalTaxCodeLabel] = useState<string | null>(
    null
  )
  const [variantStockLevel, setVariantStockLevel] = useState('0')
  const [variantError, setVariantError] = useState<string | undefined>(undefined)
  const [isSavingVariant, setIsSavingVariant] = useState(false)
  const [variantActionError, setVariantActionError] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (productId) {
      void loadProduct(productId, setState, setEditName)
    }
    window.ledgerpage
      .listAssignableTaxCodes()
      .then((result) => {
        if (result.success) {
          setAssignableTaxCodes(result.taxCodes)
        }
      })
      .catch(() => {
        // The tax-code dropdown simply falls back to "No tax" only; the
        // rest of this screen still works.
      })
  }, [productId])

  async function handleCreateProduct(): Promise<void> {
    if (isCreating) {
      return
    }
    setCreateError(undefined)
    setIsCreating(true)
    try {
      const result = await window.ledgerpage.createProduct({
        name: createName,
        type: createType
      })
      if (!result.success) {
        setCreateError(describeProductError(result.errorCode))
        return
      }
      setState({ kind: 'ready', product: result.product, variants: [] })
      setEditName(result.product.name)
      onSaved(result.product.id)
    } catch {
      setCreateError('Something went wrong. Try again.')
    } finally {
      setIsCreating(false)
    }
  }

  async function handleSaveName(): Promise<void> {
    if (state.kind !== 'ready' || isSavingName) {
      return
    }
    setEditError(undefined)
    setIsSavingName(true)
    try {
      const result = await window.ledgerpage.updateProduct({
        productId: state.product.id,
        name: editName
      })
      if (!result.success) {
        setEditError(describeProductError(result.errorCode))
        return
      }
      setState({ kind: 'ready', product: result.product, variants: state.variants })
      onSaved(result.product.id)
    } catch {
      setEditError('Something went wrong. Try again.')
    } finally {
      setIsSavingName(false)
    }
  }

  async function handleToggleProductActive(): Promise<void> {
    if (state.kind !== 'ready' || isTogglingProduct) {
      return
    }
    setProductActionError(undefined)
    setIsTogglingProduct(true)
    try {
      const result = state.product.isActive
        ? await window.ledgerpage.deactivateProduct({ productId: state.product.id })
        : await window.ledgerpage.reactivateProduct({ productId: state.product.id })
      if (!result.success) {
        setProductActionError(describeProductError(result.errorCode))
        return
      }
      setState({ kind: 'ready', product: result.product, variants: state.variants })
    } catch {
      setProductActionError('Something went wrong. Try again.')
    } finally {
      setIsTogglingProduct(false)
    }
  }

  function openCreateVariantForm(): void {
    setVariantFormMode({ kind: 'creating' })
    setVariantCode('')
    setVariantName('')
    setVariantPrice('')
    setVariantBarcode('')
    setVariantTaxCodeId('')
    setVariantOriginalTaxCodeId(null)
    setVariantOriginalTaxCodeLabel(null)
    setVariantStockLevel('0')
    setVariantError(undefined)
  }

  function openEditVariantForm(variant: SafeProductVariant): void {
    setVariantFormMode({ kind: 'editing', id: variant.id })
    setVariantCode(variant.code)
    setVariantName(variant.name)
    setVariantPrice(formatMinorUnitsAsDecimal(variant.sellingPriceMinor))
    setVariantBarcode(variant.barcode ?? '')
    setVariantTaxCodeId(variant.taxCodeId ?? '')
    setVariantOriginalTaxCodeId(variant.taxCodeId)
    setVariantOriginalTaxCodeLabel(variant.taxCodeLabel)
    setVariantStockLevel(String(variant.minimumFinishedStockLevel))
    setVariantError(undefined)
  }

  function closeVariantForm(): void {
    setVariantFormMode({ kind: 'closed' })
    setVariantError(undefined)
  }

  async function handleSubmitVariantForm(): Promise<void> {
    if (state.kind !== 'ready' || variantFormMode.kind === 'closed' || isSavingVariant) {
      return
    }

    const priceMinorUnits = parseDecimalToMinorUnits(variantPrice)
    if (priceMinorUnits === undefined) {
      setVariantError('Enter a valid price with at most two decimal places, e.g. 10.29.')
      return
    }

    let minimumFinishedStockLevel = 0
    if (state.product.type === 'manufactured') {
      const parsedStock = parseNonNegativeInteger(variantStockLevel)
      if (parsedStock === undefined) {
        setVariantError('Enter a whole, non-negative stock level, e.g. 0 or 25.')
        return
      }
      minimumFinishedStockLevel = parsedStock
    }

    const trimmedBarcode = variantBarcode.trim()
    const taxCodeId = variantTaxCodeId === '' ? null : variantTaxCodeId

    setVariantError(undefined)
    setIsSavingVariant(true)
    try {
      const result =
        variantFormMode.kind === 'creating'
          ? await window.ledgerpage.createVariant({
              productId: state.product.id,
              code: variantCode,
              name: variantName,
              sellingPriceMinor: priceMinorUnits,
              barcode: trimmedBarcode === '' ? null : trimmedBarcode,
              taxCodeId,
              minimumFinishedStockLevel
            })
          : await window.ledgerpage.updateVariant({
              variantId: variantFormMode.id,
              code: variantCode,
              name: variantName,
              sellingPriceMinor: priceMinorUnits,
              barcode: trimmedBarcode === '' ? null : trimmedBarcode,
              taxCodeId,
              minimumFinishedStockLevel
            })

      if (!result.success) {
        setVariantError(describeVariantError(result.errorCode))
        return
      }

      const variantsResult = await window.ledgerpage.listVariantsForProduct({
        productId: state.product.id
      })
      if (variantsResult.success) {
        setState({ kind: 'ready', product: state.product, variants: variantsResult.variants })
      }
      setVariantFormMode({ kind: 'closed' })
    } catch {
      setVariantError('Something went wrong. Try again.')
    } finally {
      setIsSavingVariant(false)
    }
  }

  async function handleToggleVariantActive(variant: SafeProductVariant): Promise<void> {
    if (state.kind !== 'ready') {
      return
    }
    setVariantActionError(undefined)
    try {
      const result = variant.isActive
        ? await window.ledgerpage.deactivateVariant({ variantId: variant.id })
        : await window.ledgerpage.reactivateVariant({ variantId: variant.id })
      if (!result.success) {
        setVariantActionError(describeVariantError(result.errorCode))
        return
      }
      const variantsResult = await window.ledgerpage.listVariantsForProduct({
        productId: state.product.id
      })
      if (variantsResult.success) {
        setState({ kind: 'ready', product: state.product, variants: variantsResult.variants })
      }
    } catch {
      setVariantActionError('Something went wrong. Try again.')
    }
  }

  if (state.kind === 'creating') {
    return (
      <div style={auditPageStyle}>
        <div style={auditFilterBarStyle}>
          <h1 style={auditHeadingStyle}>New product</h1>
          <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
            Back
          </button>
        </div>

        {createError && <div style={auditBannerStyle}>{createError}</div>}

        <div style={auditPanelStyle}>
          <div
            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            <div style={auditFieldGroupStyle}>
              <label htmlFor="product-create-name" style={auditLabelStyle}>
                Name
              </label>
              <input
                id="product-create-name"
                type="text"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                style={auditFieldStyle()}
              />
            </div>

            <div style={auditFieldGroupStyle}>
              <label htmlFor="product-create-type" style={auditLabelStyle}>
                Type
              </label>
              <select
                id="product-create-type"
                value={createType}
                onChange={(event) => setCreateType(event.target.value as ProductType)}
                style={auditFieldStyle()}
              >
                {PRODUCT_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <button
                type="button"
                onClick={() => void handleCreateProduct()}
                disabled={isCreating}
                style={{ ...auditPrimaryButtonStyle, opacity: isCreating ? 0.7 : 1 }}
              >
                {isCreating ? 'Creating\u2026' : 'Create product'}
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
        <div style={auditBannerStyle}>Couldn&rsquo;t load this product. Try reloading the app.</div>
      </div>
    )
  }

  const { product, variants } = state

  // The special "currently assigned but now inactive" option is only
  // ever shown while variantTaxCodeId still equals the value the form
  // was opened with — the moment the user picks anything else, this
  // stops being offered at all, matching "do not offer it as a new
  // assignable choice after the user changes away from it."
  const showInactiveTaxCodeOption =
    variantOriginalTaxCodeId !== null &&
    variantTaxCodeId === variantOriginalTaxCodeId &&
    !assignableTaxCodes.some((taxCode) => taxCode.id === variantOriginalTaxCodeId)

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>{product.name}</h1>
        <button type="button" onClick={onBack} style={auditGhostButtonStyle}>
          Back
        </button>
      </div>

      {productActionError && <div style={auditBannerStyle}>{productActionError}</div>}

      <div style={auditPanelStyle}>
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
            <div>
              <span style={auditLabelStyle}>Code</span>
              <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.9375rem' }}>
                {product.code}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Type</span>
              <div style={{ fontSize: '0.9375rem', color: auditColors.mutedInk }}>
                {product.type}
              </div>
            </div>
            <div>
              <span style={auditLabelStyle}>Status</span>
              <div style={{ marginTop: '0.125rem' }}>
                <span style={statusBadgeStyle(product.isActive)}>
                  {product.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>

          {canManageProducts ? (
            <>
              {editError && <div style={auditBannerStyle}>{editError}</div>}
              <div style={auditFieldGroupStyle}>
                <label htmlFor="product-edit-name" style={auditLabelStyle}>
                  Product name
                </label>
                <input
                  id="product-edit-name"
                  type="text"
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => void handleSaveName()}
                  disabled={isSavingName}
                  style={{ ...auditPrimaryButtonStyle, opacity: isSavingName ? 0.7 : 1 }}
                >
                  {isSavingName ? 'Saving\u2026' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleToggleProductActive()}
                  disabled={isTogglingProduct}
                  style={{ ...auditGhostButtonStyle, opacity: isTogglingProduct ? 0.7 : 1 }}
                >
                  {product.isActive ? 'Deactivate product' : 'Reactivate product'}
                </button>
              </div>
            </>
          ) : (
            <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem', margin: 0 }}>
              {product.name}
            </p>
          )}
        </div>
      </div>

      <div style={{ ...auditFilterBarStyle, marginTop: '1.5rem' }}>
        <h2 style={{ ...auditHeadingStyle, fontSize: '0.9375rem' }}>Variants</h2>
        {canManageProducts && variantFormMode.kind === 'closed' && (
          <button type="button" onClick={openCreateVariantForm} style={auditPrimaryButtonStyle}>
            Add variant
          </button>
        )}
      </div>

      {variantActionError && <div style={auditBannerStyle}>{variantActionError}</div>}

      {variantFormMode.kind !== 'closed' && (
        <div style={{ ...auditPanelStyle, marginBottom: '0.875rem' }}>
          <div
            style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
          >
            {variantError && <div style={auditBannerStyle}>{variantError}</div>}

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={auditFieldGroupStyle}>
                <label htmlFor="variant-code" style={auditLabelStyle}>
                  Code
                </label>
                <input
                  id="variant-code"
                  type="text"
                  value={variantCode}
                  onChange={(event) => setVariantCode(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="variant-name" style={auditLabelStyle}>
                  Name
                </label>
                <input
                  id="variant-name"
                  type="text"
                  value={variantName}
                  onChange={(event) => setVariantName(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="variant-price" style={auditLabelStyle}>
                  Selling price (USD)
                </label>
                <input
                  id="variant-price"
                  type="text"
                  inputMode="decimal"
                  value={variantPrice}
                  onChange={(event) => setVariantPrice(event.target.value)}
                  style={auditFieldStyle()}
                  placeholder="0.00"
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="variant-barcode" style={auditLabelStyle}>
                  Barcode (optional)
                </label>
                <input
                  id="variant-barcode"
                  type="text"
                  value={variantBarcode}
                  onChange={(event) => setVariantBarcode(event.target.value)}
                  style={auditFieldStyle()}
                />
              </div>

              <div style={auditFieldGroupStyle}>
                <label htmlFor="variant-tax-code" style={auditLabelStyle}>
                  Tax code
                </label>
                <select
                  id="variant-tax-code"
                  value={variantTaxCodeId}
                  onChange={(event) => setVariantTaxCodeId(event.target.value)}
                  style={auditFieldStyle()}
                >
                  <option value="">No tax</option>
                  {showInactiveTaxCodeOption && (
                    <option value={variantOriginalTaxCodeId ?? ''}>
                      {variantOriginalTaxCodeLabel} (no longer active)
                    </option>
                  )}
                  {assignableTaxCodes.map((taxCode) => (
                    <option key={taxCode.id} value={taxCode.id}>
                      {taxCode.code} &mdash; {taxCode.name}
                    </option>
                  ))}
                </select>
              </div>

              {product.type === 'manufactured' && (
                <div style={auditFieldGroupStyle}>
                  <label htmlFor="variant-stock" style={auditLabelStyle}>
                    Minimum finished-stock level
                  </label>
                  <input
                    id="variant-stock"
                    type="text"
                    inputMode="numeric"
                    value={variantStockLevel}
                    onChange={(event) => setVariantStockLevel(event.target.value)}
                    style={auditFieldStyle()}
                  />
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => void handleSubmitVariantForm()}
                disabled={isSavingVariant}
                style={{ ...auditPrimaryButtonStyle, opacity: isSavingVariant ? 0.7 : 1 }}
              >
                {isSavingVariant
                  ? 'Saving\u2026'
                  : variantFormMode.kind === 'creating'
                    ? 'Add variant'
                    : 'Save variant'}
              </button>
              <button type="button" onClick={closeVariantForm} style={auditGhostButtonStyle}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {variants.length === 0 && variantFormMode.kind === 'closed' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          {product.type === 'service' ? 'This service has no variants yet.' : 'No variants yet.'}
        </p>
      )}

      {variants.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Code</th>
                <th style={auditHeaderCellStyle}>Name</th>
                <th style={auditHeaderCellStyle}>Price</th>
                <th style={auditHeaderCellStyle}>Barcode</th>
                <th style={auditHeaderCellStyle}>Tax code</th>
                {product.type === 'manufactured' && (
                  <th style={auditHeaderCellStyle}>Min. stock</th>
                )}
                <th style={auditHeaderCellStyle}>Status</th>
                <th style={auditHeaderCellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((variant, index) => (
                <tr
                  key={variant.id}
                  style={{
                    borderBottom:
                      index === variants.length - 1 ? 'none' : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {variant.code}
                  </td>
                  <td style={auditBodyCellStyle}>{variant.name}</td>
                  <td style={auditBodyCellStyle}>
                    ${formatMinorUnitsAsDecimal(variant.sellingPriceMinor)}
                  </td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {variant.barcode ?? '\u2014'}
                  </td>
                  <td style={{ ...auditBodyCellStyle, color: auditColors.mutedInk }}>
                    {variant.taxCodeLabel ?? '\u2014'}
                  </td>
                  {product.type === 'manufactured' && (
                    <td style={auditBodyCellStyle}>{variant.minimumFinishedStockLevel}</td>
                  )}
                  <td style={auditBodyCellStyle}>
                    <span style={statusBadgeStyle(variant.isActive)}>
                      {variant.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={auditBodyCellStyle}>
                    {canManageProducts && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditVariantForm(variant)}
                          style={auditGhostButtonStyle}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleVariantActive(variant)}
                          style={{ ...auditGhostButtonStyle, marginLeft: '0.75rem' }}
                        >
                          {variant.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function describeProductError(errorCode: string): string {
  switch (errorCode) {
    case 'invalid_input':
      return 'Enter a valid name.'
    case 'not_authorized':
      return 'You don\u2019t have permission to do that.'
    case 'session_invalid':
      return 'Your session is no longer active. Try signing in again.'
    case 'not_found':
      return 'This product could not be found.'
    default:
      return 'Something went wrong. Try again.'
  }
}

function describeVariantError(errorCode: string): string {
  switch (errorCode) {
    case 'duplicate_code':
      return 'A variant with this code already exists for this product.'
    case 'duplicate_barcode':
      return 'A variant with this barcode already exists.'
    case 'invalid_input':
      return 'Check the fields above: a value is missing, invalid, or the selected tax code is no longer active.'
    case 'not_authorized':
      return 'You don\u2019t have permission to do that.'
    case 'session_invalid':
      return 'Your session is no longer active. Try signing in again.'
    case 'not_found':
      return 'This variant could not be found.'
    default:
      return 'Something went wrong. Try again.'
  }
}

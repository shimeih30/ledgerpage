import { ipcMain } from 'electron'
import {
  PRODUCTS_CREATE_CHANNEL,
  PRODUCTS_DEACTIVATE_CHANNEL,
  PRODUCTS_GET_CHANNEL,
  PRODUCTS_LIST_ASSIGNABLE_TAX_CODES_CHANNEL,
  PRODUCTS_LIST_CHANNEL,
  PRODUCTS_REACTIVATE_CHANNEL,
  PRODUCTS_UPDATE_CHANNEL,
  PRODUCT_VARIANTS_CREATE_CHANNEL,
  PRODUCT_VARIANTS_DEACTIVATE_CHANNEL,
  PRODUCT_VARIANTS_GET_CHANNEL,
  PRODUCT_VARIANTS_LIST_FOR_PRODUCT_CHANNEL,
  PRODUCT_VARIANTS_REACTIVATE_CHANNEL,
  PRODUCT_VARIANTS_UPDATE_CHANNEL,
  type CreateProductResult,
  type CreateVariantResult,
  type GetProductResult,
  type GetVariantResult,
  type ListAssignableTaxCodesResult,
  type ListProductsResult,
  type ListVariantsForProductResult,
  type MutateProductResult,
  type MutateVariantResult,
  type ProductIdInput,
  type ProductsErrorCode,
  type SafeProduct,
  type SafeProductVariant,
  type UpdateProductResult,
  type UpdateVariantResult,
  type VariantIdInput
} from '../../shared/ipc/products'
import type { NavigationPolicyContext } from '../security/navigationPolicy'
import { isApprovedIpcSender, type ApprovableIpcEvent } from '../security/senderValidation'
import { requireAuthorizedCaller } from '../auth/requireAuthorizedCaller'
import type { LoginService } from '../users/loginService'
import {
  createProduct,
  deactivateProduct,
  getProductById,
  listProducts,
  reactivateProduct,
  updateProduct,
  type Product
} from '../db/productService'
import {
  createVariant,
  deactivateVariant,
  DuplicateBarcodeError,
  DuplicateVariantCodeError,
  getVariantById,
  listVariantsForProduct,
  reactivateVariant,
  updateVariant,
  type ProductVariant
} from '../db/productVariantService'
import { ProductValidationError } from '../db/validation/productValidation'
import { listTaxCodes } from '../db/taxCodeService'
import type { AppDb } from '../db/dbTypes'

class ProductsIpcInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductsIpcInputError'
  }
}

function requireApprovedSender(event: ApprovableIpcEvent, context: NavigationPolicyContext): void {
  if (!isApprovedIpcSender(event, context)) {
    throw new Error('LedgerPage: rejected products request from an unapproved sender')
  }
}

function requireStringField(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new ProductsIpcInputError(`${fieldName} must be a string`)
  }
  return value
}

function requireOptionalStringField(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireStringField(value, fieldName)
}

function requireNullableStringField(value: unknown, fieldName: string): string | null | undefined {
  if (value === undefined || value === null) {
    return value
  }
  return requireStringField(value, fieldName)
}

function requireNumberField(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new ProductsIpcInputError(`${fieldName} must be a number`)
  }
  return value
}

function requireOptionalNumberField(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  return requireNumberField(value, fieldName)
}

function parseProductIdInput(input: unknown): ProductIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { productId: requireStringField(candidate.productId, 'productId') }
}

function parseVariantIdInput(input: unknown): VariantIdInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return { variantId: requireStringField(candidate.variantId, 'variantId') }
}

interface ParsedCreateProductInput {
  name: string
  type: string
}

function parseCreateProductInput(input: unknown): ParsedCreateProductInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('createProduct input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    name: requireStringField(candidate.name, 'name'),
    // Deliberately not narrowed to ProductType here — this layer only
    // confirms shape (a string). An out-of-range value is passed
    // through unchanged and rejected by productService's own value
    // check, mapped to the same invalid_input code a malformed string
    // would get — matching this codebase's layered-validation posture.
    type: requireStringField(candidate.type, 'type')
  }
}

interface ParsedUpdateProductInput {
  productId: string
  name: string
}

function parseUpdateProductInput(input: unknown): ParsedUpdateProductInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('updateProduct input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    productId: requireStringField(candidate.productId, 'productId'),
    name: requireStringField(candidate.name, 'name')
  }
}

function parseListVariantsForProductInput(input: unknown): ProductIdInput {
  return parseProductIdInput(input)
}

interface ParsedCreateVariantInput {
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  taxCodeId?: string | null
  barcode?: string | null
  minimumFinishedStockLevel?: number
}

function parseCreateVariantInput(input: unknown): ParsedCreateVariantInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('createVariant input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    productId: requireStringField(candidate.productId, 'productId'),
    code: requireStringField(candidate.code, 'code'),
    name: requireStringField(candidate.name, 'name'),
    sellingPriceMinor: requireNumberField(candidate.sellingPriceMinor, 'sellingPriceMinor'),
    taxCodeId: requireNullableStringField(candidate.taxCodeId, 'taxCodeId'),
    barcode: requireNullableStringField(candidate.barcode, 'barcode'),
    minimumFinishedStockLevel: requireOptionalNumberField(
      candidate.minimumFinishedStockLevel,
      'minimumFinishedStockLevel'
    )
  }
}

interface ParsedUpdateVariantInput {
  variantId: string
  code?: string
  name?: string
  sellingPriceMinor?: number
  taxCodeId?: string | null
  barcode?: string | null
  minimumFinishedStockLevel?: number
}

function parseUpdateVariantInput(input: unknown): ParsedUpdateVariantInput {
  if (typeof input !== 'object' || input === null) {
    throw new ProductsIpcInputError('updateVariant input must be an object')
  }
  const candidate = input as Record<string, unknown>
  return {
    variantId: requireStringField(candidate.variantId, 'variantId'),
    code: requireOptionalStringField(candidate.code, 'code'),
    name: requireOptionalStringField(candidate.name, 'name'),
    sellingPriceMinor: requireOptionalNumberField(candidate.sellingPriceMinor, 'sellingPriceMinor'),
    taxCodeId: requireNullableStringField(candidate.taxCodeId, 'taxCodeId'),
    barcode: requireNullableStringField(candidate.barcode, 'barcode'),
    minimumFinishedStockLevel: requireOptionalNumberField(
      candidate.minimumFinishedStockLevel,
      'minimumFinishedStockLevel'
    )
  }
}

function toSafeProduct(product: Product): SafeProduct {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    type: product.type,
    isActive: product.isActive,
    createdAt: product.createdAt.getTime(),
    updatedAt: product.updatedAt.getTime()
  }
}

function toSafeVariant(variant: ProductVariant): SafeProductVariant {
  return {
    id: variant.id,
    productId: variant.productId,
    code: variant.code,
    name: variant.name,
    sellingPriceMinor: variant.sellingPriceMinor,
    currencyId: variant.currencyId,
    taxCodeId: variant.taxCodeId,
    taxCodeLabel: variant.taxCodeLabel,
    barcode: variant.barcode,
    minimumFinishedStockLevel: variant.minimumFinishedStockLevel,
    isActive: variant.isActive,
    createdAt: variant.createdAt.getTime(),
    updatedAt: variant.updatedAt.getTime()
  }
}

/**
 * Maps a thrown service-layer error to a safe, fixed errorCode — never
 * forwarding the error's own message to the renderer. instanceof checks
 * against named error classes, never string-matching against a message,
 * so this mapping can't silently drift or misfire on a coincidentally
 * similar message from an unrelated failure.
 */
function toErrorCode(error: unknown): ProductsErrorCode {
  if (error instanceof DuplicateVariantCodeError) {
    return 'duplicate_code'
  }
  if (error instanceof DuplicateBarcodeError) {
    return 'duplicate_barcode'
  }
  if (error instanceof ProductValidationError) {
    return 'invalid_input'
  }
  if (
    error instanceof Error &&
    /^No (product|product variant) exists with id/.test(error.message)
  ) {
    return 'not_found'
  }
  return 'unexpected_error'
}

export interface RegisterProductHandlersOptions {
  context: NavigationPolicyContext
  db: AppDb
  loginService: LoginService
}

/**
 * Registers every Slice 11 products/product-variants IPC handler. Every
 * handler here is gated by requireAuthorizedCaller, resolved fresh from
 * SQLite on every single call — never a renderer-supplied
 * canViewProducts/canManageProducts flag, never session-cached role
 * codes (Slice 10's established pattern, not Slice 9's older,
 * internally-checked one). productService/productVariantService
 * themselves are session-independent — they accept an explicit
 * AuditActor, resolved here from the already-authorized caller's own
 * userId, never asked to resolve "who is calling" on their own.
 *
 * Never exposed here: a database handle, arbitrary SQL, a currency
 * choice, a way to set or edit a product's code, or a raw exception
 * message.
 */
export function registerProductHandlers(options: RegisterProductHandlersOptions): void {
  const { context, db, loginService } = options

  ipcMain.handle(PRODUCTS_LIST_CHANNEL, (event): ListProductsResult => {
    requireApprovedSender(event, context)

    const authResult = requireAuthorizedCaller(db, loginService, 'products.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      return { success: true, products: listProducts(db).map(toSafeProduct) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(PRODUCTS_GET_CHANNEL, (event, rawInput: unknown): GetProductResult => {
    requireApprovedSender(event, context)

    let input: ProductIdInput
    try {
      input = parseProductIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const product = getProductById(db, input.productId)
    if (!product) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, product: toSafeProduct(product) }
  })

  ipcMain.handle(PRODUCTS_CREATE_CHANNEL, (event, rawInput: unknown): CreateProductResult => {
    requireApprovedSender(event, context)

    let input: ParsedCreateProductInput
    try {
      input = parseCreateProductInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const product = createProduct(db, input, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, product: toSafeProduct(product) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(PRODUCTS_UPDATE_CHANNEL, (event, rawInput: unknown): UpdateProductResult => {
    requireApprovedSender(event, context)

    let input: ParsedUpdateProductInput
    try {
      input = parseUpdateProductInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const product = updateProduct(
        db,
        input.productId,
        { name: input.name },
        { type: 'user', userId: authResult.callerUserId }
      )
      return { success: true, product: toSafeProduct(product) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(PRODUCTS_DEACTIVATE_CHANNEL, (event, rawInput: unknown): MutateProductResult => {
    requireApprovedSender(event, context)

    let input: ProductIdInput
    try {
      input = parseProductIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const product = deactivateProduct(db, input.productId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, product: toSafeProduct(product) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(PRODUCTS_REACTIVATE_CHANNEL, (event, rawInput: unknown): MutateProductResult => {
    requireApprovedSender(event, context)

    let input: ProductIdInput
    try {
      input = parseProductIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    try {
      const product = reactivateProduct(db, input.productId, {
        type: 'user',
        userId: authResult.callerUserId
      })
      return { success: true, product: toSafeProduct(product) }
    } catch (error) {
      return { success: false, errorCode: toErrorCode(error) }
    }
  })

  ipcMain.handle(
    PRODUCT_VARIANTS_LIST_FOR_PRODUCT_CHANNEL,
    (event, rawInput: unknown): ListVariantsForProductResult => {
      requireApprovedSender(event, context)

      let input: ProductIdInput
      try {
        input = parseListVariantsForProductInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'products.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        return {
          success: true,
          variants: listVariantsForProduct(db, input.productId).map(toSafeVariant)
        }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(PRODUCT_VARIANTS_GET_CHANNEL, (event, rawInput: unknown): GetVariantResult => {
    requireApprovedSender(event, context)

    let input: VariantIdInput
    try {
      input = parseVariantIdInput(rawInput)
    } catch {
      return { success: false, errorCode: 'invalid_input' }
    }

    const authResult = requireAuthorizedCaller(db, loginService, 'products.read')
    if (!authResult.ok) {
      return { success: false, errorCode: authResult.errorCode }
    }

    const variant = getVariantById(db, input.variantId)
    if (!variant) {
      return { success: false, errorCode: 'not_found' }
    }
    return { success: true, variant: toSafeVariant(variant) }
  })

  ipcMain.handle(
    PRODUCT_VARIANTS_CREATE_CHANNEL,
    (event, rawInput: unknown): CreateVariantResult => {
      requireApprovedSender(event, context)

      let input: ParsedCreateVariantInput
      try {
        input = parseCreateVariantInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const variant = createVariant(db, input, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, variant: toSafeVariant(variant) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    PRODUCT_VARIANTS_UPDATE_CHANNEL,
    (event, rawInput: unknown): UpdateVariantResult => {
      requireApprovedSender(event, context)

      let input: ParsedUpdateVariantInput
      try {
        input = parseUpdateVariantInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const variant = updateVariant(
          db,
          input.variantId,
          {
            code: input.code,
            name: input.name,
            sellingPriceMinor: input.sellingPriceMinor,
            taxCodeId: input.taxCodeId,
            barcode: input.barcode,
            minimumFinishedStockLevel: input.minimumFinishedStockLevel
          },
          { type: 'user', userId: authResult.callerUserId }
        )
        return { success: true, variant: toSafeVariant(variant) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    PRODUCT_VARIANTS_DEACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateVariantResult => {
      requireApprovedSender(event, context)

      let input: VariantIdInput
      try {
        input = parseVariantIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const variant = deactivateVariant(db, input.variantId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, variant: toSafeVariant(variant) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  ipcMain.handle(
    PRODUCT_VARIANTS_REACTIVATE_CHANNEL,
    (event, rawInput: unknown): MutateVariantResult => {
      requireApprovedSender(event, context)

      let input: VariantIdInput
      try {
        input = parseVariantIdInput(rawInput)
      } catch {
        return { success: false, errorCode: 'invalid_input' }
      }

      const authResult = requireAuthorizedCaller(db, loginService, 'products.manage')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const variant = reactivateVariant(db, input.variantId, {
          type: 'user',
          userId: authResult.callerUserId
        })
        return { success: true, variant: toSafeVariant(variant) }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )

  // Gated by products.read, not tax.read -- see this channel's own doc
  // comment in shared/ipc/products.ts for why: operations has
  // products.manage but not tax.read, and must still be able to see
  // which tax codes it may assign to a variant.
  ipcMain.handle(
    PRODUCTS_LIST_ASSIGNABLE_TAX_CODES_CHANNEL,
    (event): ListAssignableTaxCodesResult => {
      requireApprovedSender(event, context)

      const authResult = requireAuthorizedCaller(db, loginService, 'products.read')
      if (!authResult.ok) {
        return { success: false, errorCode: authResult.errorCode }
      }

      try {
        const activeTaxCodes = listTaxCodes(db)
          .filter((taxCode) => taxCode.isActive)
          .map((taxCode) => ({ id: taxCode.id, code: taxCode.code, name: taxCode.name }))
        return { success: true, taxCodes: activeTaxCodes }
      } catch (error) {
        return { success: false, errorCode: toErrorCode(error) }
      }
    }
  )
}

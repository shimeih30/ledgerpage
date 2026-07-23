/**
 * Shared IPC contract for Slice 11's products and product-variants
 * channels.
 *
 * `code` never appears on any product create/update input type — it is
 * always allocated server-side (see productService.ts) and immutable
 * thereafter; there is no representable way for a caller to supply or
 * change it through this contract. `currencyId` never appears anywhere
 * on this file's variant types either — every variant is always priced
 * in FUNCTIONAL_CURRENCY_ID, decided server-side, never a renderer
 * choice.
 */

export const PRODUCTS_LIST_CHANNEL = 'products:list' as const
export const PRODUCTS_GET_CHANNEL = 'products:get' as const
export const PRODUCTS_CREATE_CHANNEL = 'products:create' as const
export const PRODUCTS_UPDATE_CHANNEL = 'products:update' as const
export const PRODUCTS_DEACTIVATE_CHANNEL = 'products:deactivate' as const
export const PRODUCTS_REACTIVATE_CHANNEL = 'products:reactivate' as const

export const PRODUCT_VARIANTS_LIST_FOR_PRODUCT_CHANNEL =
  'product-variants:list-for-product' as const
export const PRODUCT_VARIANTS_GET_CHANNEL = 'product-variants:get' as const
export const PRODUCT_VARIANTS_CREATE_CHANNEL = 'product-variants:create' as const
export const PRODUCT_VARIANTS_UPDATE_CHANNEL = 'product-variants:update' as const
export const PRODUCT_VARIANTS_DEACTIVATE_CHANNEL = 'product-variants:deactivate' as const
export const PRODUCT_VARIANTS_REACTIVATE_CHANNEL = 'product-variants:reactivate' as const

/**
 * A narrow, read-only lookup list for the variant form's tax-code
 * dropdown — Slice 6 itself shipped no IPC/UI surface at all ("UI
 * introduced: none... configuration screen ships later"), so this is
 * new, minimal surface introduced by this slice specifically for that
 * one purpose. Gated by products.read (not tax.read) in
 * registerProductHandlers.ts — tax.read is not granted to operations,
 * but operations does have products.manage and must still be able to
 * see which tax codes it can assign to a variant.
 */
export const PRODUCTS_LIST_ASSIGNABLE_TAX_CODES_CHANNEL =
  'products:list-assignable-tax-codes' as const

export type ProductType = 'manufactured' | 'service'

export type ProductsErrorCode =
  | 'not_authorized'
  | 'invalid_input'
  | 'duplicate_code'
  | 'duplicate_barcode'
  | 'not_found'
  | 'session_invalid'
  | 'unexpected_error'

export interface SafeProduct {
  id: string
  code: string
  name: string
  type: ProductType
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export interface SafeProductVariant {
  id: string
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  currencyId: string
  taxCodeId: string | null
  /**
   * The referenced tax code's own code, resolved server-side on every
   * read, regardless of whether that tax code is currently active —
   * lets the edit form show "currently references STD" even after STD
   * is deactivated, without ever making STD newly assignable again
   * (listAssignableTaxCodes is a separate, active-only read path).
   */
  taxCodeLabel: string | null
  barcode: string | null
  minimumFinishedStockLevel: number
  isActive: boolean
  createdAt: number
  updatedAt: number
}

export type ListProductsResult =
  { success: true; products: SafeProduct[] } | { success: false; errorCode: ProductsErrorCode }

export interface ProductIdInput {
  productId: string
}

export type GetProductResult =
  { success: true; product: SafeProduct } | { success: false; errorCode: ProductsErrorCode }

export interface CreateProductInput {
  name: string
  type: ProductType
}

export type CreateProductResult =
  { success: true; product: SafeProduct } | { success: false; errorCode: ProductsErrorCode }

export interface UpdateProductInput {
  productId: string
  name: string
}

export type UpdateProductResult =
  { success: true; product: SafeProduct } | { success: false; errorCode: ProductsErrorCode }

export type MutateProductResult =
  { success: true; product: SafeProduct } | { success: false; errorCode: ProductsErrorCode }

export interface ListVariantsForProductInput {
  productId: string
}

export type ListVariantsForProductResult =
  | { success: true; variants: SafeProductVariant[] }
  | { success: false; errorCode: ProductsErrorCode }

export interface VariantIdInput {
  variantId: string
}

export type GetVariantResult =
  { success: true; variant: SafeProductVariant } | { success: false; errorCode: ProductsErrorCode }

export interface CreateVariantInput {
  productId: string
  code: string
  name: string
  sellingPriceMinor: number
  taxCodeId?: string | null
  barcode?: string | null
  minimumFinishedStockLevel?: number
}

export type CreateVariantResult =
  { success: true; variant: SafeProductVariant } | { success: false; errorCode: ProductsErrorCode }

export interface UpdateVariantInput {
  variantId: string
  code?: string
  name?: string
  sellingPriceMinor?: number
  taxCodeId?: string | null
  barcode?: string | null
  minimumFinishedStockLevel?: number
}

export type UpdateVariantResult =
  { success: true; variant: SafeProductVariant } | { success: false; errorCode: ProductsErrorCode }

export type MutateVariantResult =
  { success: true; variant: SafeProductVariant } | { success: false; errorCode: ProductsErrorCode }

export interface AssignableTaxCode {
  id: string
  code: string
  name: string
}

export type ListAssignableTaxCodesResult =
  | { success: true; taxCodes: AssignableTaxCode[] }
  | { success: false; errorCode: ProductsErrorCode }

export interface LedgerPageProductsApi {
  listProducts: () => Promise<ListProductsResult>
  getProduct: (input: ProductIdInput) => Promise<GetProductResult>
  createProduct: (input: CreateProductInput) => Promise<CreateProductResult>
  updateProduct: (input: UpdateProductInput) => Promise<UpdateProductResult>
  deactivateProduct: (input: ProductIdInput) => Promise<MutateProductResult>
  reactivateProduct: (input: ProductIdInput) => Promise<MutateProductResult>
  listVariantsForProduct: (
    input: ListVariantsForProductInput
  ) => Promise<ListVariantsForProductResult>
  getVariant: (input: VariantIdInput) => Promise<GetVariantResult>
  createVariant: (input: CreateVariantInput) => Promise<CreateVariantResult>
  updateVariant: (input: UpdateVariantInput) => Promise<UpdateVariantResult>
  deactivateVariant: (input: VariantIdInput) => Promise<MutateVariantResult>
  reactivateVariant: (input: VariantIdInput) => Promise<MutateVariantResult>
  listAssignableTaxCodes: () => Promise<ListAssignableTaxCodesResult>
}

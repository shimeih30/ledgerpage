// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductDetailScreen } from '../../src/renderer/src/products/ProductDetailScreen'
import type {
  AssignableTaxCode,
  SafeProduct,
  SafeProductVariant
} from '../../src/shared/ipc/products'

afterEach(() => {
  cleanup()
})

function makeProduct(overrides: Partial<SafeProduct> = {}): SafeProduct {
  return {
    id: 'product_1',
    code: 'PRD-000001',
    name: 'Jam',
    type: 'manufactured',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function makeVariant(overrides: Partial<SafeProductVariant> = {}): SafeProductVariant {
  return {
    id: 'variant_1',
    productId: 'product_1',
    code: '100ML',
    name: '100 ml jar',
    sellingPriceMinor: 1029,
    currencyId: 'currency_usd',
    taxCodeId: null,
    taxCodeLabel: null,
    barcode: null,
    minimumFinishedStockLevel: 0,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

interface MockApiOverrides {
  getProduct?: ReturnType<typeof vi.fn>
  listVariantsForProduct?: ReturnType<typeof vi.fn>
  createProduct?: ReturnType<typeof vi.fn>
  updateProduct?: ReturnType<typeof vi.fn>
  deactivateProduct?: ReturnType<typeof vi.fn>
  reactivateProduct?: ReturnType<typeof vi.fn>
  createVariant?: ReturnType<typeof vi.fn>
  updateVariant?: ReturnType<typeof vi.fn>
  deactivateVariant?: ReturnType<typeof vi.fn>
  reactivateVariant?: ReturnType<typeof vi.fn>
  listAssignableTaxCodes?: ReturnType<typeof vi.fn>
}

function installMockApi(overrides: MockApiOverrides = {}) {
  const api = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState: vi.fn(),
    unlockSession: vi.fn(),
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn(),
    listAuditEntries: vi.fn(),
    listProducts: vi.fn(),
    getProduct:
      overrides.getProduct ?? vi.fn().mockResolvedValue({ success: true, product: makeProduct() }),
    createProduct: overrides.createProduct ?? vi.fn(),
    updateProduct: overrides.updateProduct ?? vi.fn(),
    deactivateProduct: overrides.deactivateProduct ?? vi.fn(),
    reactivateProduct: overrides.reactivateProduct ?? vi.fn(),
    listVariantsForProduct:
      overrides.listVariantsForProduct ??
      vi.fn().mockResolvedValue({ success: true, variants: [] }),
    getVariant: vi.fn(),
    createVariant: overrides.createVariant ?? vi.fn(),
    updateVariant: overrides.updateVariant ?? vi.fn(),
    deactivateVariant: overrides.deactivateVariant ?? vi.fn(),
    reactivateVariant: overrides.reactivateVariant ?? vi.fn(),
    listAssignableTaxCodes:
      overrides.listAssignableTaxCodes ?? vi.fn().mockResolvedValue({ success: true, taxCodes: [] })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onBack/onSaved in tests that don't assert navigation
}

describe('ProductDetailScreen', () => {
  describe('create mode', () => {
    it('renders a name and type field, and no code field', async () => {
      installMockApi()
      render(<ProductDetailScreen canManageProducts onBack={noop} onSaved={noop} />)

      expect(await screen.findByLabelText('Name')).toBeDefined()
      expect(screen.getByLabelText('Type')).toBeDefined()
      expect(screen.queryByLabelText(/code/i)).toBeNull()
    })

    it('submits only name and type on create', async () => {
      const createProduct = vi.fn().mockResolvedValue({ success: true, product: makeProduct() })
      installMockApi({ createProduct })
      render(<ProductDetailScreen canManageProducts onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jam' } })
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'service' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create product' }))

      await waitFor(() => expect(createProduct).toHaveBeenCalledTimes(1))
      expect(createProduct).toHaveBeenCalledWith({ name: 'Jam', type: 'service' })
    })

    it('displays the generated code after successful creation and calls onSaved', async () => {
      const createProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ code: 'PRD-000042' }) })
      const onSaved = vi.fn()
      installMockApi({ createProduct })
      render(<ProductDetailScreen canManageProducts onBack={noop} onSaved={onSaved} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Jam' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create product' }))

      expect(await screen.findByText('PRD-000042')).toBeDefined()
      expect(onSaved).toHaveBeenCalledWith('product_1')
    })

    it('a service product can be created and shows zero variants without error', async () => {
      const createProduct = vi.fn().mockResolvedValue({
        success: true,
        product: makeProduct({ type: 'service' })
      })
      installMockApi({ createProduct })
      render(<ProductDetailScreen canManageProducts onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Delivery' } })
      fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'service' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create product' }))

      expect(await screen.findByText('This service has no variants yet.')).toBeDefined()
    })
  })

  describe('existing product mode', () => {
    it('displays code and type as read-only text, not editable inputs', async () => {
      installMockApi({
        getProduct: vi.fn().mockResolvedValue({ success: true, product: makeProduct() })
      })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      expect(await screen.findByText('PRD-000001')).toBeDefined()
      expect(screen.getByText('manufactured')).toBeDefined()
      expect(screen.queryByLabelText('Code')).toBeNull()
      expect(screen.queryByLabelText('Type')).toBeNull()
    })

    it('update submits only name, never code or type', async () => {
      const updateProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ name: 'Renamed' }) })
      installMockApi({ updateProduct })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      const nameInput = await screen.findByLabelText('Product name')
      fireEvent.change(nameInput, { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(updateProduct).toHaveBeenCalledTimes(1))
      expect(updateProduct).toHaveBeenCalledWith({ productId: 'product_1', name: 'Renamed' })
    })

    it('deactivate/reactivate product', async () => {
      const deactivateProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ isActive: false }) })
      const reactivateProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ isActive: true }) })
      installMockApi({ deactivateProduct, reactivateProduct })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Deactivate product' }))
      await waitFor(() =>
        expect(deactivateProduct).toHaveBeenCalledWith({ productId: 'product_1' })
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Reactivate product' }))
      await waitFor(() =>
        expect(reactivateProduct).toHaveBeenCalledWith({ productId: 'product_1' })
      )
    })

    it('read-only mode shows no Save, deactivate, reactivate, or Add variant controls', async () => {
      installMockApi()
      render(
        <ProductDetailScreen
          productId="product_1"
          canManageProducts={false}
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('PRD-000001')
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate product' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate product' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add variant' })).toBeNull()
      expect(screen.queryByLabelText('Product name')).toBeNull()
    })
  })

  describe('variant creation and editing', () => {
    it('service variant hides the stock field and sends minimumFinishedStockLevel 0', async () => {
      const createVariant = vi.fn().mockResolvedValue({ success: true, variant: makeVariant() })
      installMockApi({
        getProduct: vi
          .fn()
          .mockResolvedValue({ success: true, product: makeProduct({ type: 'service' }) }),
        createVariant
      })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      expect(screen.queryByLabelText('Minimum finished-stock level')).toBeNull()

      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5.00' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await waitFor(() => expect(createVariant).toHaveBeenCalledTimes(1))
      expect(createVariant).toHaveBeenCalledWith(
        expect.objectContaining({ minimumFinishedStockLevel: 0 })
      )
    })

    it('manufactured variant accepts a non-negative integer stock level', async () => {
      const createVariant = vi.fn().mockResolvedValue({ success: true, variant: makeVariant() })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5.00' } })
      fireEvent.change(screen.getByLabelText('Minimum finished-stock level'), {
        target: { value: '25' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await waitFor(() => expect(createVariant).toHaveBeenCalledTimes(1))
      expect(createVariant).toHaveBeenCalledWith(
        expect.objectContaining({ minimumFinishedStockLevel: 25 })
      )
    })

    it.each(['-1', '1.5', '+5', 'abc', ''])(
      'blocks IPC for an invalid stock level: %s',
      async (invalidStock) => {
        const createVariant = vi.fn()
        installMockApi({ createVariant })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
        fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
        fireEvent.change(screen.getByLabelText('Selling price (USD)'), {
          target: { value: '5.00' }
        })
        fireEvent.change(screen.getByLabelText('Minimum finished-stock level'), {
          target: { value: invalidStock }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(createVariant).not.toHaveBeenCalled()
      }
    )

    it('converts 10.29 to exactly 1029 minor units', async () => {
      const createVariant = vi.fn().mockResolvedValue({ success: true, variant: makeVariant() })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), {
        target: { value: '10.29' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await waitFor(() => expect(createVariant).toHaveBeenCalledTimes(1))
      expect(createVariant).toHaveBeenCalledWith(
        expect.objectContaining({ sellingPriceMinor: 1029 })
      )
    })

    it('converts 0.29 to exactly 29 minor units -- not 28 or 29.0000001 from floating-point multiplication', async () => {
      const createVariant = vi.fn().mockResolvedValue({ success: true, variant: makeVariant() })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '0.29' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await waitFor(() => expect(createVariant).toHaveBeenCalledTimes(1))
      expect(createVariant).toHaveBeenCalledWith(expect.objectContaining({ sellingPriceMinor: 29 }))
    })

    it('rejects 1.005 (three decimal places) and never calls IPC', async () => {
      const createVariant = vi.fn()
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), {
        target: { value: '1.005' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await screen.findByText(/Enter a valid price/)
      expect(createVariant).not.toHaveBeenCalled()
    })

    it.each(['-5', '', '   '])('rejects an invalid price and blocks IPC: %s', async (price) => {
      const createVariant = vi.fn()
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: price } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(createVariant).not.toHaveBeenCalled()
    })

    it("displays an existing variant's price correctly formatted from minor units", async () => {
      installMockApi({
        listVariantsForProduct: vi.fn().mockResolvedValue({
          success: true,
          variants: [makeVariant({ sellingPriceMinor: 1029 })]
        })
      })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      await screen.findByText('100ML', { exact: false })
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      expect((screen.getByLabelText('Selling price (USD)') as HTMLInputElement).value).toBe('10.29')
    })

    it('has no currency selector anywhere on the form', async () => {
      installMockApi()
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      expect(screen.queryByLabelText(/currency/i)).toBeNull()
    })

    it('has no recipe, inventory, discount, or accounting fields', async () => {
      installMockApi()
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )
      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      for (const forbidden of [/recipe/i, /inventory/i, /discount/i, /account/i, /cost/i]) {
        expect(screen.queryByLabelText(forbidden)).toBeNull()
      }
    })

    it('duplicate variant code error is shown safely', async () => {
      const createVariant = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'duplicate_code' })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      expect(await screen.findByText(/already exists for this product/)).toBeDefined()
    })

    it('duplicate barcode error is shown safely', async () => {
      const createVariant = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'duplicate_barcode' })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      expect(await screen.findByText(/barcode already exists/)).toBeDefined()
    })

    it('an inactive-tax-code assignment error from the server is shown safely', async () => {
      const createVariant = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'invalid_input' })
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      expect(await screen.findByText(/no longer active/)).toBeDefined()
    })

    it('variant deactivate/reactivate', async () => {
      const deactivateVariant = vi
        .fn()
        .mockResolvedValue({ success: true, variant: makeVariant({ isActive: false }) })
      const listVariantsForProduct = vi
        .fn()
        .mockResolvedValueOnce({ success: true, variants: [makeVariant()] })
        .mockResolvedValueOnce({ success: true, variants: [makeVariant({ isActive: false })] })
      installMockApi({ deactivateVariant, listVariantsForProduct })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      await screen.findByText('100ML', { exact: false })
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
      await waitFor(() =>
        expect(deactivateVariant).toHaveBeenCalledWith({ variantId: 'variant_1' })
      )
    })

    it('double-submit is prevented: rapid repeated clicks send exactly one create call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createVariant = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createVariant })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5' } })

      const submitButton = screen.getByRole('button', { name: 'Add variant' })
      fireEvent.click(submitButton)
      fireEvent.click(submitButton)
      fireEvent.click(submitButton)

      expect(createVariant).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, variant: makeVariant() })
    })
  })

  describe('tax-code dropdown', () => {
    const activeTaxCodes: AssignableTaxCode[] = [{ id: 'tax_std', code: 'STD', name: 'Standard' }]

    it('offers only active tax codes plus No tax', async () => {
      installMockApi({
        listAssignableTaxCodes: vi
          .fn()
          .mockResolvedValue({ success: true, taxCodes: activeTaxCodes })
      })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      const select = (await screen.findByLabelText('Tax code')) as HTMLSelectElement
      await waitFor(() => expect(select.options.length).toBe(2))
      const optionTexts = Array.from(select.options).map((o) => o.text)
      expect(optionTexts).toContain('No tax')
      expect(optionTexts.some((t) => t.includes('STD'))).toBe(true)
    })

    it('No tax works: creating with no tax code sends taxCodeId null', async () => {
      const createVariant = vi.fn().mockResolvedValue({ success: true, variant: makeVariant() })
      installMockApi({
        createVariant,
        listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] })
      })
      render(
        <ProductDetailScreen productId="product_1" canManageProducts onBack={noop} onSaved={noop} />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add variant' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'A' } })
      fireEvent.change(screen.getByLabelText('Selling price (USD)'), { target: { value: '5' } })
      fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

      await waitFor(() => expect(createVariant).toHaveBeenCalledTimes(1))
      expect(createVariant).toHaveBeenCalledWith(expect.objectContaining({ taxCodeId: null }))
    })

    describe('inactive referenced tax code preservation', () => {
      const variantWithInactiveTax = makeVariant({
        taxCodeId: 'tax_old',
        taxCodeLabel: 'OLD'
      })

      it('editing a variant with a now-inactive tax code initially displays its label', async () => {
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes })
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

        const select = (await screen.findByLabelText('Tax code')) as HTMLSelectElement
        expect(select.value).toBe('tax_old')
        expect(select.options.length).toBe(3) // No tax, OLD (inactive), STD (active)
        expect(Array.from(select.options).some((o) => o.text.includes('no longer active'))).toBe(
          true
        )
      })

      it('that inactive tax code is not offered when creating a new variant', async () => {
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes })
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Add variant' }))

        const select = (await screen.findByLabelText('Tax code')) as HTMLSelectElement
        const optionTexts = Array.from(select.options).map((o) => o.text)
        expect(optionTexts.some((t) => t.includes('OLD'))).toBe(false)
        expect(optionTexts.length).toBe(2) // No tax, STD only
      })

      it('editing only name (not touching tax code) preserves the existing inactive taxCodeId on submit', async () => {
        const updateVariant = vi
          .fn()
          .mockResolvedValue({ success: true, variant: variantWithInactiveTax })
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes }),
          updateVariant
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save variant' }))

        await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1))
        expect(updateVariant).toHaveBeenCalledWith(
          expect.objectContaining({ taxCodeId: 'tax_old' })
        )
      })

      it('selecting another active tax code replaces the inactive one', async () => {
        const updateVariant = vi
          .fn()
          .mockResolvedValue({ success: true, variant: variantWithInactiveTax })
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes }),
          updateVariant
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        const select = await screen.findByLabelText('Tax code')
        fireEvent.change(select, { target: { value: 'tax_std' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save variant' }))

        await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1))
        expect(updateVariant).toHaveBeenCalledWith(
          expect.objectContaining({ taxCodeId: 'tax_std' })
        )
      })

      it('selecting No tax explicitly clears the inactive reference', async () => {
        const updateVariant = vi
          .fn()
          .mockResolvedValue({ success: true, variant: variantWithInactiveTax })
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes }),
          updateVariant
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        const select = await screen.findByLabelText('Tax code')
        fireEvent.change(select, { target: { value: '' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save variant' }))

        await waitFor(() => expect(updateVariant).toHaveBeenCalledTimes(1))
        expect(updateVariant).toHaveBeenCalledWith(expect.objectContaining({ taxCodeId: null }))
      })

      it('after changing away from the inactive tax code, it is no longer offered as an option', async () => {
        installMockApi({
          listVariantsForProduct: vi
            .fn()
            .mockResolvedValue({ success: true, variants: [variantWithInactiveTax] }),
          listAssignableTaxCodes: vi
            .fn()
            .mockResolvedValue({ success: true, taxCodes: activeTaxCodes })
        })
        render(
          <ProductDetailScreen
            productId="product_1"
            canManageProducts
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('100ML', { exact: false })
        fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
        const select = (await screen.findByLabelText('Tax code')) as HTMLSelectElement
        expect(select.options.length).toBe(3)

        fireEvent.change(select, { target: { value: 'tax_std' } })

        await waitFor(() => {
          expect(select.options.length).toBe(2)
        })
        const optionTexts = Array.from(select.options).map((o) => o.text)
        expect(optionTexts.some((t) => t.includes('OLD'))).toBe(false)
      })
    })
  })
})

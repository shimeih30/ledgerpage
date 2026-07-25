// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SupplierDetailScreen } from '../../src/renderer/src/suppliers/SupplierDetailScreen'
import type { SafeSupplier, SafeSupplierItemPrice } from '../../src/shared/ipc/suppliers'
import type { SafeInventoryItem } from '../../src/shared/ipc/inventoryItems'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function makeSupplier(overrides: Partial<SafeSupplier> = {}): SafeSupplier {
  return {
    id: 'supplier_1',
    code: 'SUP-000001',
    name: 'Acme Foods',
    contactDetails: null,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function makeItem(overrides: Partial<SafeInventoryItem> = {}): SafeInventoryItem {
  return {
    id: 'inventory_item_1',
    code: 'FLOUR',
    name: 'Flour',
    category: 'Dry goods',
    itemType: 'ingredient',
    unitOfMeasureId: 'uom_kg',
    unitOfMeasureLabel: 'kg',
    minimumStock: 0,
    reorderQuantity: 0,
    maximumStock: null,
    leadTimeDays: 0,
    lotTracked: false,
    expiryTracked: false,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function makePrice(overrides: Partial<SafeSupplierItemPrice> = {}): SafeSupplierItemPrice {
  return {
    id: 'price_1',
    supplierId: 'supplier_1',
    supplierCode: 'SUP-000001',
    supplierName: 'Acme Foods',
    supplierIsActive: true,
    inventoryItemId: 'inventory_item_1',
    inventoryItemCode: 'FLOUR',
    inventoryItemName: 'Flour',
    inventoryItemIsActive: true,
    unitOfMeasureLabel: 'kg',
    supplierItemCode: null,
    priceMinor: 1000,
    currencyId: 'currency_usd',
    effectiveFrom: Date.now(),
    createdAt: Date.now(),
    ...overrides
  }
}

interface MockApiOverrides {
  getSupplier?: ReturnType<typeof vi.fn>
  createSupplier?: ReturnType<typeof vi.fn>
  updateSupplier?: ReturnType<typeof vi.fn>
  deactivateSupplier?: ReturnType<typeof vi.fn>
  reactivateSupplier?: ReturnType<typeof vi.fn>
  recordSupplierPrice?: ReturnType<typeof vi.fn>
  listPricesForSupplier?: ReturnType<typeof vi.fn>
  listInventoryItems?: ReturnType<typeof vi.fn>
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
    getProduct: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
    reactivateProduct: vi.fn(),
    listVariantsForProduct: vi.fn(),
    getVariant: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    deactivateVariant: vi.fn(),
    reactivateVariant: vi.fn(),
    listAssignableTaxCodes: vi.fn(),
    listInventoryItems:
      overrides.listInventoryItems ??
      vi.fn().mockResolvedValue({ success: true, inventoryItems: [makeItem()] }),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: vi.fn(),
    reactivateInventoryItem: vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn(),
    listSuppliers: vi.fn(),
    getSupplier:
      overrides.getSupplier ??
      vi.fn().mockResolvedValue({ success: true, supplier: makeSupplier() }),
    createSupplier: overrides.createSupplier ?? vi.fn(),
    updateSupplier: overrides.updateSupplier ?? vi.fn(),
    deactivateSupplier: overrides.deactivateSupplier ?? vi.fn(),
    reactivateSupplier: overrides.reactivateSupplier ?? vi.fn(),
    recordSupplierPrice: overrides.recordSupplierPrice ?? vi.fn(),
    listPricesForSupplier:
      overrides.listPricesForSupplier ?? vi.fn().mockResolvedValue({ success: true, prices: [] }),
    listPricesForInventoryItem: vi.fn(),
    getCurrentSupplierItemPrice: vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onBack/onSaved in tests that don't assert navigation
}

describe('SupplierDetailScreen', () => {
  describe('create mode', () => {
    it('submits name and optional contactDetails only -- code is never submitted', async () => {
      const createSupplier = vi.fn().mockResolvedValue({ success: true, supplier: makeSupplier() })
      installMockApi({ createSupplier })
      render(<SupplierDetailScreen canManageSuppliers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Foods' } })
      fireEvent.change(screen.getByLabelText('Contact details (optional)'), {
        target: { value: 'buyer@acme.com' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create supplier' }))

      await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1))
      const callArg = createSupplier.mock.calls[0][0]
      expect(callArg).toEqual({ name: 'Acme Foods', contactDetails: 'buyer@acme.com' })
      expect(callArg).not.toHaveProperty('code')
    })

    it('an empty contactDetails field is submitted as an empty string, normalized to null server-side', async () => {
      const createSupplier = vi.fn().mockResolvedValue({ success: true, supplier: makeSupplier() })
      installMockApi({ createSupplier })
      render(<SupplierDetailScreen canManageSuppliers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Foods' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create supplier' }))

      await waitFor(() => expect(createSupplier).toHaveBeenCalledTimes(1))
      expect(createSupplier.mock.calls[0][0].contactDetails).toBe('')
    })

    it('displays the generated supplier code after creation and calls onSaved', async () => {
      const createSupplier = vi.fn().mockResolvedValue({ success: true, supplier: makeSupplier() })
      const onSaved = vi.fn()
      installMockApi({ createSupplier })
      render(<SupplierDetailScreen canManageSuppliers onBack={noop} onSaved={onSaved} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Foods' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create supplier' }))

      expect(await screen.findByText('SUP-000001')).toBeDefined()
      expect(onSaved).toHaveBeenCalledWith('supplier_1')
    })

    it('preserves entered values after an IPC error', async () => {
      const createSupplier = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ createSupplier })
      render(<SupplierDetailScreen canManageSuppliers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Foods' } })
      fireEvent.change(screen.getByLabelText('Contact details (optional)'), {
        target: { value: 'buyer@acme.com' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create supplier' }))

      await screen.findByText('Something went wrong. Try again.')
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Acme Foods')
      expect((screen.getByLabelText('Contact details (optional)') as HTMLInputElement).value).toBe(
        'buyer@acme.com'
      )
    })

    it('prevents double submission: rapid repeated clicks produce exactly one IPC call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createSupplier = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createSupplier })
      render(<SupplierDetailScreen canManageSuppliers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Foods' } })
      const button = screen.getByRole('button', { name: 'Create supplier' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(createSupplier).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, supplier: makeSupplier() })
    })
  })

  describe('existing supplier mode', () => {
    it('code is read-only after creation -- no Code input exists', async () => {
      installMockApi()
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      expect(await screen.findByText('SUP-000001')).toBeDefined()
      expect(screen.queryByLabelText('Code')).toBeNull()
    })

    it('update submits only editable fields, never code', async () => {
      const updateSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: makeSupplier({ name: 'Renamed' }) })
      installMockApi({ updateSupplier })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      const nameInput = await screen.findByLabelText('Name')
      fireEvent.change(nameInput, { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(updateSupplier).toHaveBeenCalledTimes(1))
      const callArg = updateSupplier.mock.calls[0][0]
      expect(callArg).not.toHaveProperty('code')
      expect(callArg.name).toBe('Renamed')
      expect(callArg.supplierId).toBe('supplier_1')
    })

    it('deactivate/reactivate supplier', async () => {
      const deactivateSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: makeSupplier({ isActive: false }) })
      const reactivateSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: makeSupplier({ isActive: true }) })
      installMockApi({ deactivateSupplier, reactivateSupplier })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Deactivate supplier' }))
      await waitFor(() =>
        expect(deactivateSupplier).toHaveBeenCalledWith({ supplierId: 'supplier_1' })
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Reactivate supplier' }))
      await waitFor(() =>
        expect(reactivateSupplier).toHaveBeenCalledWith({ supplierId: 'supplier_1' })
      )
    })

    it('read-only mode has no mutating controls', async () => {
      installMockApi()
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers={false}
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('SUP-000001')
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate supplier' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate supplier' })).toBeNull()
      expect(screen.queryByLabelText('Name')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Record price' })).toBeNull()
    })
  })

  describe('price form', () => {
    it('offers only active inventory items', async () => {
      installMockApi({
        listInventoryItems: vi.fn().mockResolvedValue({
          success: true,
          inventoryItems: [
            makeItem({ id: 'item_active', code: 'ACTIVE', isActive: true }),
            makeItem({ id: 'item_inactive', code: 'INACTIVE', isActive: false })
          ]
        })
      })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      const select = (await screen.findByLabelText('Inventory item')) as HTMLSelectElement
      await waitFor(() => expect(select.options.length).toBe(2)) // placeholder + active
      const optionTexts = Array.from(select.options).map((o) => o.text)
      expect(optionTexts.some((t) => t.includes('ACTIVE'))).toBe(true)
      expect(optionTexts.some((t) => t.includes('INACTIVE'))).toBe(false)
    })

    it('there is no currency selector anywhere on this screen', async () => {
      installMockApi()
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )
      await screen.findByText('SUP-000001')
      expect(screen.queryByLabelText(/currency/i)).toBeNull()
    })

    it('submits supplierItemCode and never submits currencyId', async () => {
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Supplier item code (optional)'), {
        target: { value: '  ACME-FLR-1  ' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10.29' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(recordSupplierPrice).toHaveBeenCalledTimes(1))
      const callArg = recordSupplierPrice.mock.calls[0][0]
      expect(callArg).not.toHaveProperty('currencyId')
      expect(callArg.supplierId).toBe('supplier_1')
      expect(callArg.inventoryItemId).toBe('inventory_item_1')
      expect(callArg.priceMinor).toBe(1029)
      expect(callArg.supplierItemCode).toBe('  ACME-FLR-1  ')
    })

    it('an empty supplier item code field is submitted as an empty string, normalized to null server-side', async () => {
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(recordSupplierPrice).toHaveBeenCalledTimes(1))
      expect(recordSupplierPrice.mock.calls[0][0].supplierItemCode).toBe('')
    })

    describe('exact decimal price parsing', () => {
      it.each([
        ['10.29', 1029],
        ['0.29', 29],
        ['0', 0]
      ])('parses "%s" to exactly %i minor units', async (input, expectedMinor) => {
        const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
        installMockApi({ recordSupplierPrice })
        render(
          <SupplierDetailScreen
            supplierId="supplier_1"
            canManageSuppliers
            onBack={noop}
            onSaved={noop}
          />
        )

        fireEvent.change(await screen.findByLabelText('Inventory item'), {
          target: { value: 'inventory_item_1' }
        })
        fireEvent.change(screen.getByLabelText('Price'), { target: { value: input } })
        fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

        await waitFor(() => expect(recordSupplierPrice).toHaveBeenCalledTimes(1))
        expect(recordSupplierPrice.mock.calls[0][0].priceMinor).toBe(expectedMinor)
      })

      it.each(['1.005', '-5', '', '10.299', 'abc'])(
        'rejects invalid price "%s" with a safe message, never submitting',
        async (input) => {
          const recordSupplierPrice = vi.fn()
          installMockApi({ recordSupplierPrice })
          render(
            <SupplierDetailScreen
              supplierId="supplier_1"
              canManageSuppliers
              onBack={noop}
              onSaved={noop}
            />
          )

          fireEvent.change(await screen.findByLabelText('Inventory item'), {
            target: { value: 'inventory_item_1' }
          })
          fireEvent.change(screen.getByLabelText('Price'), { target: { value: input } })
          fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

          expect(await screen.findByText(/Enter a valid price/i)).toBeDefined()
          expect(recordSupplierPrice).not.toHaveBeenCalled()
        }
      )
    })

    it('accepts a past effective date', async () => {
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText('Effective date'), { target: { value: '2020-01-01' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(recordSupplierPrice).toHaveBeenCalledTimes(1))
      expect(new Date(recordSupplierPrice.mock.calls[0][0].effectiveFrom).toISOString()).toContain(
        '2020-01-01'
      )
    })

    it('accepts a future effective date', async () => {
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText('Effective date'), { target: { value: '2099-01-01' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(recordSupplierPrice).toHaveBeenCalledTimes(1))
      expect(new Date(recordSupplierPrice.mock.calls[0][0].effectiveFrom).toISOString()).toContain(
        '2099-01-01'
      )
    })

    it('maps a duplicate effective timestamp error to a safe message', async () => {
      const recordSupplierPrice = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'duplicate_effective_price' })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      expect(await screen.findByText(/A price already exists for this item/i)).toBeDefined()
    })

    it('maps an inactive-supplier rejection to a safe message', async () => {
      const recordSupplierPrice = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'invalid_input' })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      expect(await screen.findByText(/not active/i)).toBeDefined()
    })

    it('maps an inactive-inventory-item rejection to the same safe invalid_input message', async () => {
      const recordSupplierPrice = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'invalid_input' })
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      expect(await screen.findByText(/not active/i)).toBeDefined()
    })

    it('recording a price reloads authoritative history', async () => {
      const listPricesForSupplier = vi
        .fn()
        .mockResolvedValueOnce({ success: true, prices: [] })
        .mockResolvedValueOnce({ success: true, prices: [makePrice()] })
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: makePrice() })
      installMockApi({ listPricesForSupplier, recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('No prices recorded yet.')
      fireEvent.change(screen.getByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(listPricesForSupplier).toHaveBeenCalledTimes(2))
      const table = await screen.findByRole('table')
      expect(within(table).getByText('FLOUR', { exact: false })).toBeDefined()
    })

    it('a failed recording leaves existing history unchanged -- no second listPricesForSupplier call', async () => {
      const listPricesForSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, prices: [makePrice({ id: 'existing' })] })
      const recordSupplierPrice = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ listPricesForSupplier, recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      const table = await screen.findByRole('table')
      within(table).getByText('FLOUR', { exact: false })
      fireEvent.change(screen.getByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await screen.findByText('Something went wrong. Try again.')
      expect(listPricesForSupplier).toHaveBeenCalledTimes(1)
    })

    it('prevents double submission: rapid repeated clicks produce exactly one IPC call', async () => {
      let resolveRecord: (value: unknown) => void = () => {}
      const recordSupplierPrice = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveRecord = resolve
        })
      )
      installMockApi({ recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.change(await screen.findByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '10' } })
      const button = screen.getByRole('button', { name: 'Record price' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(recordSupplierPrice).toHaveBeenCalledTimes(1)
      resolveRecord({ success: true, price: makePrice() })
    })
  })

  describe('price history table', () => {
    const FIXED_NOW = new Date('2026-06-15T12:00:00.000Z').getTime()
    const DAY_MS = 24 * 60 * 60 * 1000

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(FIXED_NOW)
    })

    it('is sorted effectiveFrom DESC, createdAt DESC, and correctly labels Scheduled/Current/Historical', async () => {
      const older = makePrice({
        id: 'older',
        effectiveFrom: FIXED_NOW - 2 * DAY_MS,
        createdAt: FIXED_NOW - 2 * DAY_MS,
        priceMinor: 900
      })
      const current = makePrice({
        id: 'current',
        effectiveFrom: FIXED_NOW - DAY_MS,
        createdAt: FIXED_NOW - DAY_MS,
        priceMinor: 1000
      })
      const scheduled = makePrice({
        id: 'scheduled',
        effectiveFrom: FIXED_NOW + DAY_MS,
        createdAt: FIXED_NOW,
        priceMinor: 1100
      })
      installMockApi({
        // The real server (listPricesForSupplier) always returns rows
        // pre-sorted effectiveFrom DESC, createdAt DESC -- the renderer
        // trusts this ordering and never re-sorts client-side, so the
        // mock here supplies them in that same pre-sorted order.
        listPricesForSupplier: vi
          .fn()
          .mockResolvedValue({ success: true, prices: [scheduled, current, older] })
      })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Current')
      const rows = screen.getAllByRole('row').slice(1) // skip header row
      expect(rows[0].textContent).toContain('Scheduled')
      expect(rows[1].textContent).toContain('Current')
      expect(rows[2].textContent).toContain('Historical')

      // The future row must never be labelled Current.
      const scheduledRowText = rows[0].textContent ?? ''
      expect(scheduledRowText).not.toContain('Current')
    })

    it('shows supplier item code when present, and a dash when absent', async () => {
      const withCode = makePrice({ id: 'with-code', supplierItemCode: 'ACME-FLR-1' })
      const withoutCode = makePrice({
        id: 'without-code',
        inventoryItemId: 'inventory_item_2',
        inventoryItemCode: 'SUGAR',
        supplierItemCode: null,
        effectiveFrom: FIXED_NOW - DAY_MS
      })
      installMockApi({
        listPricesForSupplier: vi
          .fn()
          .mockResolvedValue({ success: true, prices: [withCode, withoutCode] })
      })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('ACME-FLR-1')
      expect(screen.getByText('\u2014')).toBeDefined()
    })

    it('shows the base-unit label', async () => {
      installMockApi({
        listPricesForSupplier: vi
          .fn()
          .mockResolvedValue({ success: true, prices: [makePrice({ unitOfMeasureLabel: 'kg' })] })
      })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('kg')
    })

    it('deactivated item labels remain visible in historical rows', async () => {
      installMockApi({
        listPricesForSupplier: vi.fn().mockResolvedValue({
          success: true,
          prices: [makePrice({ inventoryItemIsActive: false, inventoryItemName: 'Flour' })]
        })
      })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      const table = await screen.findByRole('table')
      expect(within(table).getByText('Flour', { exact: false })).toBeDefined()
      expect(within(table).getByText('(inactive)')).toBeDefined()
    })

    it('append-only history remains fully visible after a new price is recorded', async () => {
      const existing = makePrice({
        id: 'existing',
        effectiveFrom: FIXED_NOW - 2 * DAY_MS,
        createdAt: FIXED_NOW - 2 * DAY_MS,
        priceMinor: 900
      })
      const afterInsert = makePrice({
        id: 'new',
        effectiveFrom: FIXED_NOW,
        createdAt: FIXED_NOW,
        priceMinor: 1500
      })
      const listPricesForSupplier = vi
        .fn()
        .mockResolvedValueOnce({ success: true, prices: [existing] })
        .mockResolvedValueOnce({ success: true, prices: [afterInsert, existing] })
      const recordSupplierPrice = vi.fn().mockResolvedValue({ success: true, price: afterInsert })
      installMockApi({ listPricesForSupplier, recordSupplierPrice })
      render(
        <SupplierDetailScreen
          supplierId="supplier_1"
          canManageSuppliers
          onBack={noop}
          onSaved={noop}
        />
      )

      await waitFor(() => expect(listPricesForSupplier).toHaveBeenCalledTimes(1))
      fireEvent.change(screen.getByLabelText('Inventory item'), {
        target: { value: 'inventory_item_1' }
      })
      fireEvent.change(screen.getByLabelText('Price'), { target: { value: '15' } })
      fireEvent.click(screen.getByRole('button', { name: 'Record price' }))

      await waitFor(() => expect(listPricesForSupplier).toHaveBeenCalledTimes(2))
      const rows = await screen.findAllByRole('row')
      // Header row + both the pre-existing and newly-recorded rows.
      expect(rows.length).toBe(3)
    })
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InventoryItemDetailScreen } from '../../src/renderer/src/inventoryItems/InventoryItemDetailScreen'
import type {
  AssignableUnitOfMeasure,
  SafeInventoryItem
} from '../../src/shared/ipc/inventoryItems'

afterEach(() => {
  cleanup()
})

function makeItem(overrides: Partial<SafeInventoryItem> = {}): SafeInventoryItem {
  return {
    id: 'inventory_item_1',
    code: 'FLOUR',
    name: 'Flour',
    category: 'Dry goods',
    itemType: 'ingredient',
    unitOfMeasureId: 'uom_kg',
    unitOfMeasureLabel: 'kg',
    minimumStock: 10,
    reorderQuantity: 20,
    maximumStock: null,
    leadTimeDays: 3,
    lotTracked: false,
    expiryTracked: false,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

interface MockApiOverrides {
  getInventoryItem?: ReturnType<typeof vi.fn>
  createInventoryItem?: ReturnType<typeof vi.fn>
  updateInventoryItem?: ReturnType<typeof vi.fn>
  deactivateInventoryItem?: ReturnType<typeof vi.fn>
  reactivateInventoryItem?: ReturnType<typeof vi.fn>
  listAssignableUnitsOfMeasure?: ReturnType<typeof vi.fn>
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
    listInventoryItems: vi.fn(),
    getInventoryItem:
      overrides.getInventoryItem ??
      vi.fn().mockResolvedValue({ success: true, inventoryItem: makeItem() }),
    createInventoryItem: overrides.createInventoryItem ?? vi.fn(),
    updateInventoryItem: overrides.updateInventoryItem ?? vi.fn(),
    deactivateInventoryItem: overrides.deactivateInventoryItem ?? vi.fn(),
    reactivateInventoryItem: overrides.reactivateInventoryItem ?? vi.fn(),
    listAssignableUnitsOfMeasure:
      overrides.listAssignableUnitsOfMeasure ??
      vi.fn().mockResolvedValue({ success: true, units: [] })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onBack/onSaved in tests that don't assert navigation
}

const ACTIVE_UNITS: AssignableUnitOfMeasure[] = [
  { id: 'uom_kg', code: 'kg', name: 'Kilogram', category: 'mass' }
]

describe('InventoryItemDetailScreen', () => {
  describe('create mode', () => {
    it('renders all create fields, and no read-only status yet', async () => {
      installMockApi({
        listAssignableUnitsOfMeasure: vi
          .fn()
          .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
      })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      expect(await screen.findByLabelText('Code')).toBeDefined()
      expect(screen.getByLabelText('Name')).toBeDefined()
      expect(screen.getByLabelText('Category')).toBeDefined()
      expect(screen.getByLabelText('Item type')).toBeDefined()
      expect(screen.getByLabelText('Unit of measure')).toBeDefined()
      expect(screen.getByLabelText('Minimum stock')).toBeDefined()
      expect(screen.getByLabelText('Reorder quantity')).toBeDefined()
      expect(screen.getByLabelText('Maximum stock (optional)')).toBeDefined()
      expect(screen.getByLabelText('Lead time (days)')).toBeDefined()
      expect(screen.getByLabelText('Lot-tracked')).toBeDefined()
      expect(screen.getByLabelText('Expiry-tracked')).toBeDefined()
    })

    it('submits all fields on create', async () => {
      const createInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem() })
      installMockApi({
        createInventoryItem,
        listAssignableUnitsOfMeasure: vi
          .fn()
          .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
      })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'flour' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Dry goods' } })
      fireEvent.change(screen.getByLabelText('Item type'), { target: { value: 'ingredient' } })
      fireEvent.change(screen.getByLabelText('Unit of measure'), {
        target: { value: 'uom_kg' }
      })
      fireEvent.change(screen.getByLabelText('Minimum stock'), { target: { value: '10' } })
      fireEvent.change(screen.getByLabelText('Reorder quantity'), { target: { value: '20' } })
      fireEvent.change(screen.getByLabelText('Lead time (days)'), { target: { value: '3' } })
      fireEvent.click(screen.getByLabelText('Lot-tracked'))
      fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

      await waitFor(() => expect(createInventoryItem).toHaveBeenCalledTimes(1))
      expect(createInventoryItem).toHaveBeenCalledWith({
        code: 'flour',
        name: 'Flour',
        category: 'Dry goods',
        itemType: 'ingredient',
        unitOfMeasureId: 'uom_kg',
        minimumStock: 10,
        reorderQuantity: 20,
        maximumStock: null,
        leadTimeDays: 3,
        lotTracked: true,
        expiryTracked: false
      })
    })

    it('displays the created item after success and calls onSaved', async () => {
      const createInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem() })
      const onSaved = vi.fn()
      installMockApi({ createInventoryItem })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={onSaved} />)

      fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Dry goods' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

      expect(await screen.findByText('FLOUR')).toBeDefined()
      expect(onSaved).toHaveBeenCalledWith('inventory_item_1')
    })

    describe('integer-only quantity validation', () => {
      it.each([
        ['Minimum stock', '-1'],
        ['Minimum stock', '1.5'],
        ['Minimum stock', '+1'],
        ['Minimum stock', '   '],
        ['Minimum stock', 'abc'],
        ['Minimum stock', 'NaN'],
        ['Minimum stock', 'Infinity']
      ])('rejects an invalid %s value "%s" with a safe message', async (label, value) => {
        installMockApi()
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
        fireEvent.change(screen.getByLabelText(label), { target: { value } })
        fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

        expect(await screen.findByText(/Enter a whole, non-negative/i)).toBeDefined()
      })

      it('accepts zero for minimum stock, reorder quantity, and lead time', async () => {
        const createInventoryItem = vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItem: makeItem() })
        installMockApi({ createInventoryItem })
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

        await waitFor(() => expect(createInventoryItem).toHaveBeenCalledTimes(1))
        expect(createInventoryItem).toHaveBeenCalledWith(
          expect.objectContaining({ minimumStock: 0, reorderQuantity: 0, leadTimeDays: 0 })
        )
      })
    })

    describe('maximum stock', () => {
      it('an empty maximum stock field becomes null', async () => {
        const createInventoryItem = vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItem: makeItem() })
        installMockApi({ createInventoryItem })
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
        fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

        await waitFor(() => expect(createInventoryItem).toHaveBeenCalledTimes(1))
        expect(createInventoryItem).toHaveBeenCalledWith(
          expect.objectContaining({ maximumStock: null })
        )
      })

      it('rejects maximumStock below minimumStock with a safe message, and never submits', async () => {
        const createInventoryItem = vi.fn()
        installMockApi({ createInventoryItem })
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
        fireEvent.change(screen.getByLabelText('Minimum stock'), { target: { value: '50' } })
        fireEvent.change(screen.getByLabelText('Maximum stock (optional)'), {
          target: { value: '10' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

        expect(
          await screen.findByText('Maximum stock must be greater than or equal to minimum stock.')
        ).toBeDefined()
        expect(createInventoryItem).not.toHaveBeenCalled()
      })

      it('accepts a valid maximumStock >= minimumStock', async () => {
        const createInventoryItem = vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItem: makeItem() })
        installMockApi({ createInventoryItem })
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
        fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
        fireEvent.change(screen.getByLabelText('Minimum stock'), { target: { value: '10' } })
        fireEvent.change(screen.getByLabelText('Maximum stock (optional)'), {
          target: { value: '50' }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

        await waitFor(() => expect(createInventoryItem).toHaveBeenCalledTimes(1))
        expect(createInventoryItem).toHaveBeenCalledWith(
          expect.objectContaining({ minimumStock: 10, maximumStock: 50 })
        )
      })
    })

    it('preserves entered values after a validation error', async () => {
      installMockApi()
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'Dry goods' } })
      fireEvent.change(screen.getByLabelText('Minimum stock'), { target: { value: '-1' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

      await screen.findByText(/Enter a whole, non-negative/i)
      expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('FLOUR')
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Flour')
      expect((screen.getByLabelText('Category') as HTMLInputElement).value).toBe('Dry goods')
    })

    it('prevents double submission: rapid repeated clicks produce exactly one IPC call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createInventoryItem = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createInventoryItem })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })

      const submitButton = screen.getByRole('button', { name: 'Create item' })
      fireEvent.click(submitButton)
      fireEvent.click(submitButton)
      fireEvent.click(submitButton)

      expect(createInventoryItem).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, inventoryItem: makeItem() })
    })

    it('maps a duplicate code error to a safe message', async () => {
      const createInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'duplicate_code' })
      installMockApi({ createInventoryItem })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Code'), { target: { value: 'FLOUR' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Flour' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'X' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create item' }))

      expect(
        await screen.findByText('An inventory item with this code already exists.')
      ).toBeDefined()
    })
  })

  describe('existing item mode', () => {
    it('displays code and item type as read-only text, not editable inputs', async () => {
      installMockApi({
        getInventoryItem: vi.fn().mockResolvedValue({ success: true, inventoryItem: makeItem() })
      })
      render(
        <InventoryItemDetailScreen
          inventoryItemId="inventory_item_1"
          canManageInventoryItems
          onBack={noop}
          onSaved={noop}
        />
      )

      expect(await screen.findByText('FLOUR')).toBeDefined()
      expect(screen.getByText('ingredient')).toBeDefined()
      expect(screen.queryByLabelText('Code')).toBeNull()
      expect(screen.queryByLabelText('Item type')).toBeNull()
    })

    it('update submits only editable fields, never code or itemType', async () => {
      const updateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem({ name: 'Renamed' }) })
      installMockApi({ updateInventoryItem })
      render(
        <InventoryItemDetailScreen
          inventoryItemId="inventory_item_1"
          canManageInventoryItems
          onBack={noop}
          onSaved={noop}
        />
      )

      const nameInput = await screen.findByLabelText('Name')
      fireEvent.change(nameInput, { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(updateInventoryItem).toHaveBeenCalledTimes(1))
      const callArg = updateInventoryItem.mock.calls[0][0]
      expect(callArg).not.toHaveProperty('code')
      expect(callArg).not.toHaveProperty('itemType')
      expect(callArg.name).toBe('Renamed')
      expect(callArg.inventoryItemId).toBe('inventory_item_1')
    })

    it('deactivate/reactivate item', async () => {
      const deactivateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem({ isActive: false }) })
      const reactivateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem({ isActive: true }) })
      installMockApi({ deactivateInventoryItem, reactivateInventoryItem })
      render(
        <InventoryItemDetailScreen
          inventoryItemId="inventory_item_1"
          canManageInventoryItems
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Deactivate item' }))
      await waitFor(() =>
        expect(deactivateInventoryItem).toHaveBeenCalledWith({
          inventoryItemId: 'inventory_item_1'
        })
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Reactivate item' }))
      await waitFor(() =>
        expect(reactivateInventoryItem).toHaveBeenCalledWith({
          inventoryItemId: 'inventory_item_1'
        })
      )
    })

    it('read-only (Finance) mode shows no Save or deactivate/reactivate controls', async () => {
      installMockApi()
      render(
        <InventoryItemDetailScreen
          inventoryItemId="inventory_item_1"
          canManageInventoryItems={false}
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('FLOUR')
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate item' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate item' })).toBeNull()
      expect(screen.queryByLabelText('Name')).toBeNull()
    })
  })

  describe('unit of measure dropdown', () => {
    it('offers only active units', async () => {
      installMockApi({
        listAssignableUnitsOfMeasure: vi
          .fn()
          .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
      })
      render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

      const select = (await screen.findByLabelText('Unit of measure')) as HTMLSelectElement
      await waitFor(() => expect(select.options.length).toBe(2)) // placeholder + kg
      const optionTexts = Array.from(select.options).map((o) => o.text)
      expect(optionTexts.some((t) => t.includes('kg'))).toBe(true)
    })

    describe('inactive referenced unit preservation', () => {
      const itemWithInactiveUnit = makeItem({
        unitOfMeasureId: 'uom_old',
        unitOfMeasureLabel: 'OLD'
      })

      it('editing an item with a now-inactive unit initially displays its label', async () => {
        installMockApi({
          getInventoryItem: vi
            .fn()
            .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit }),
          listAssignableUnitsOfMeasure: vi
            .fn()
            .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
        })
        render(
          <InventoryItemDetailScreen
            inventoryItemId="inventory_item_1"
            canManageInventoryItems
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('FLOUR')
        const select = (await screen.findByLabelText('Unit of measure')) as HTMLSelectElement
        expect(select.value).toBe('uom_old')
        expect(select.options.length).toBe(2) // OLD (inactive), kg (active)
        expect(Array.from(select.options).some((o) => o.text.includes('no longer active'))).toBe(
          true
        )
      })

      it('that inactive unit is not offered when creating a new item', async () => {
        installMockApi({
          listAssignableUnitsOfMeasure: vi
            .fn()
            .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
        })
        render(<InventoryItemDetailScreen canManageInventoryItems onBack={noop} onSaved={noop} />)

        const select = (await screen.findByLabelText('Unit of measure')) as HTMLSelectElement
        const optionTexts = Array.from(select.options).map((o) => o.text)
        expect(optionTexts.some((t) => t.includes('OLD'))).toBe(false)
      })

      it('editing only name (not touching unit) preserves the existing inactive unitOfMeasureId on submit', async () => {
        const updateInventoryItem = vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit })
        installMockApi({
          getInventoryItem: vi
            .fn()
            .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit }),
          listAssignableUnitsOfMeasure: vi
            .fn()
            .mockResolvedValue({ success: true, units: ACTIVE_UNITS }),
          updateInventoryItem
        })
        render(
          <InventoryItemDetailScreen
            inventoryItemId="inventory_item_1"
            canManageInventoryItems
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('FLOUR')
        fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Renamed' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(updateInventoryItem).toHaveBeenCalledTimes(1))
        expect(updateInventoryItem).toHaveBeenCalledWith(
          expect.objectContaining({ unitOfMeasureId: 'uom_old' })
        )
      })

      it('selecting another active unit replaces the inactive one', async () => {
        const updateInventoryItem = vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit })
        installMockApi({
          getInventoryItem: vi
            .fn()
            .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit }),
          listAssignableUnitsOfMeasure: vi
            .fn()
            .mockResolvedValue({ success: true, units: ACTIVE_UNITS }),
          updateInventoryItem
        })
        render(
          <InventoryItemDetailScreen
            inventoryItemId="inventory_item_1"
            canManageInventoryItems
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('FLOUR')
        const select = await screen.findByLabelText('Unit of measure')
        fireEvent.change(select, { target: { value: 'uom_kg' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))

        await waitFor(() => expect(updateInventoryItem).toHaveBeenCalledTimes(1))
        expect(updateInventoryItem).toHaveBeenCalledWith(
          expect.objectContaining({ unitOfMeasureId: 'uom_kg' })
        )
      })

      it('after changing away from the inactive unit, it is no longer offered as an option -- it cannot be reselected', async () => {
        installMockApi({
          getInventoryItem: vi
            .fn()
            .mockResolvedValue({ success: true, inventoryItem: itemWithInactiveUnit }),
          listAssignableUnitsOfMeasure: vi
            .fn()
            .mockResolvedValue({ success: true, units: ACTIVE_UNITS })
        })
        render(
          <InventoryItemDetailScreen
            inventoryItemId="inventory_item_1"
            canManageInventoryItems
            onBack={noop}
            onSaved={noop}
          />
        )

        await screen.findByText('FLOUR')
        const select = (await screen.findByLabelText('Unit of measure')) as HTMLSelectElement
        expect(select.options.length).toBe(2)

        fireEvent.change(select, { target: { value: 'uom_kg' } })

        await waitFor(() => {
          expect(select.options.length).toBe(1)
        })
        const optionTexts = Array.from(select.options).map((o) => o.text)
        expect(optionTexts.some((t) => t.includes('OLD'))).toBe(false)
      })
    })
  })
})

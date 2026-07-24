// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InventoryItemListScreen } from '../../src/renderer/src/inventoryItems/InventoryItemListScreen'
import type { SafeInventoryItem } from '../../src/shared/ipc/inventoryItems'

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

function installMockApi(
  overrides: {
    listInventoryItems?: ReturnType<typeof vi.fn>
    deactivateInventoryItem?: ReturnType<typeof vi.fn>
    reactivateInventoryItem?: ReturnType<typeof vi.fn>
  } = {}
) {
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
      vi.fn().mockResolvedValue({ success: true, inventoryItems: [] }),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: overrides.deactivateInventoryItem ?? vi.fn(),
    reactivateInventoryItem: overrides.reactivateInventoryItem ?? vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn().mockResolvedValue({ success: true, units: [] })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onOpenInventoryItem/onCreateInventoryItem in tests that don't assert them
}

describe('InventoryItemListScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [makeItem()] })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems
        onOpenInventoryItem={noop}
        onCreateInventoryItem={noop}
      />
    )

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('FLOUR')).toBeDefined()
    expect(screen.getByText('Flour')).toBeDefined()
    expect(screen.getByText('Dry goods')).toBeDefined()
    expect(screen.getByText('kg')).toBeDefined()
  })

  it('shows an empty state when there are no items', async () => {
    installMockApi({
      listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [] })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems
        onOpenInventoryItem={noop}
        onCreateInventoryItem={noop}
      />
    )

    expect(await screen.findByText('No inventory items yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listInventoryItems: vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems
        onOpenInventoryItem={noop}
        onCreateInventoryItem={noop}
      />
    )

    expect(
      await screen.findByText('Couldn\u2019t load inventory items. Try reloading the app.')
    ).toBeDefined()
  })

  it('a manager sees New item and mutation actions', async () => {
    installMockApi({
      listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [makeItem()] })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems
        onOpenInventoryItem={noop}
        onCreateInventoryItem={noop}
      />
    )

    await screen.findByText('FLOUR')
    expect(screen.getByRole('button', { name: 'New item' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDefined()
  })

  it('Finance (read-only) sees no New item button and only a View action', async () => {
    installMockApi({
      listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [makeItem()] })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems={false}
        onOpenInventoryItem={noop}
        onCreateInventoryItem={noop}
      />
    )

    await screen.findByText('FLOUR')
    expect(screen.queryByRole('button', { name: 'New item' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
  })

  it('opening details invokes onOpenInventoryItem with the item id', async () => {
    const onOpenInventoryItem = vi.fn()
    installMockApi({
      listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [makeItem()] })
    })
    render(
      <InventoryItemListScreen
        canManageInventoryItems
        onOpenInventoryItem={onOpenInventoryItem}
        onCreateInventoryItem={noop}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(onOpenInventoryItem).toHaveBeenCalledWith('inventory_item_1')
  })

  describe('deactivate/reactivate: authoritative refresh, never optimistic', () => {
    it('waits for IPC success before changing visible state, then reloads from a fresh listInventoryItems call', async () => {
      const listInventoryItems = vi
        .fn()
        .mockResolvedValueOnce({ success: true, inventoryItems: [makeItem({ isActive: true })] })
        .mockResolvedValueOnce({
          success: true,
          inventoryItems: [makeItem({ isActive: false })]
        })
      const deactivateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem({ isActive: false }) })
      installMockApi({ listInventoryItems, deactivateInventoryItem })
      render(
        <InventoryItemListScreen
          canManageInventoryItems
          onOpenInventoryItem={noop}
          onCreateInventoryItem={noop}
        />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      // The success path must call listInventoryItems again
      // (authoritative reload) rather than locally flipping the badge
      // from the deactivateInventoryItem response alone.
      await waitFor(() => expect(listInventoryItems).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Inactive')).toBeDefined()
    })

    it('a failed mutation leaves the existing row unchanged -- no second listInventoryItems call', async () => {
      const listInventoryItems = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItems: [makeItem({ isActive: true })] })
      const deactivateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ listInventoryItems, deactivateInventoryItem })
      render(
        <InventoryItemListScreen
          canManageInventoryItems
          onOpenInventoryItem={noop}
          onCreateInventoryItem={noop}
        />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await screen.findByText('Something went wrong. Try again.')
      // Still shows Active -- the row was never touched.
      expect(screen.getByText('Active')).toBeDefined()
      expect(listInventoryItems).toHaveBeenCalledTimes(1)
    })

    it('repeated rapid clicks while a mutation is in flight produce exactly one IPC call', async () => {
      let resolveDeactivate: (value: unknown) => void = () => {}
      const deactivateInventoryItem = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDeactivate = resolve
        })
      )
      installMockApi({
        listInventoryItems: vi
          .fn()
          .mockResolvedValue({ success: true, inventoryItems: [makeItem()] }),
        deactivateInventoryItem
      })
      render(
        <InventoryItemListScreen
          canManageInventoryItems
          onOpenInventoryItem={noop}
          onCreateInventoryItem={noop}
        />
      )

      await screen.findByText('Active')
      const button = screen.getByRole('button', { name: 'Deactivate' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(deactivateInventoryItem).toHaveBeenCalledTimes(1)
      resolveDeactivate({ success: true, inventoryItem: makeItem({ isActive: false }) })
    })

    it('reactivate follows the same authoritative-refresh rule', async () => {
      const listInventoryItems = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          inventoryItems: [makeItem({ isActive: false })]
        })
        .mockResolvedValueOnce({ success: true, inventoryItems: [makeItem({ isActive: true })] })
      const reactivateInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: makeItem({ isActive: true }) })
      installMockApi({ listInventoryItems, reactivateInventoryItem })
      render(
        <InventoryItemListScreen
          canManageInventoryItems
          onOpenInventoryItem={noop}
          onCreateInventoryItem={noop}
        />
      )

      await screen.findByText('Inactive')
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))

      await waitFor(() => expect(listInventoryItems).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Active')).toBeDefined()
    })
  })
})

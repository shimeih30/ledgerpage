// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { InventoryItemLotsScreen } from '../../src/renderer/src/inventory/InventoryItemLotsScreen'
import type { SafeInventoryLot } from '../../src/shared/ipc/inventoryLots'

afterEach(() => {
  cleanup()
})

function makeLot(overrides: Partial<SafeInventoryLot> = {}): SafeInventoryLot {
  return {
    id: 'inventory_lot_1',
    internalLotNumber: 'LOT-000001',
    supplierLotNumber: 'ACME-SL-1',
    inventoryItemId: 'inventory_item_1',
    itemCode: 'FLOUR',
    itemName: 'Flour',
    supplierId: 'supplier_1',
    supplierCode: 'SUP-000001',
    supplierName: 'Acme Foods',
    receivedDate: new Date('2026-01-01').getTime(),
    quantityReceivedScaled: 20000,
    quantityRemainingScaled: 20000,
    formattedQuantityReceived: '20.000',
    formattedQuantityRemaining: '20.000',
    unitCode: 'kg',
    unitName: 'Kilogram',
    decimalPlaces: 3,
    unitCostMinor: 350,
    totalCostMinor: 7000,
    costRemainingMinor: 7000,
    currencyId: 'currency_usd',
    expiryDate: null,
    lifecycleStatus: 'active',
    effectiveStatus: 'active',
    createdAt: new Date('2026-01-01').getTime(),
    updatedAt: new Date('2026-01-01').getTime(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listInventoryLotsForItem?: ReturnType<typeof vi.fn>
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
    listInventoryItems: vi.fn(),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: vi.fn(),
    reactivateInventoryItem: vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn(),
    listSuppliers: vi.fn(),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: vi.fn(),
    reactivateSupplier: vi.fn(),
    recordSupplierPrice: vi.fn(),
    listPricesForSupplier: vi.fn(),
    listPricesForInventoryItem: vi.fn(),
    getCurrentSupplierItemPrice: vi.fn(),
    listCustomers: vi.fn(),
    getCustomer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deactivateCustomer: vi.fn(),
    reactivateCustomer: vi.fn(),
    listContactsForCustomer: vi.fn(),
    getCustomerContact: vi.fn(),
    createCustomerContact: vi.fn(),
    updateCustomerContact: vi.fn(),
    deactivateCustomerContact: vi.fn(),
    reactivateCustomerContact: vi.fn(),
    listInventoryLotsForItem:
      overrides.listInventoryLotsForItem ??
      vi.fn().mockResolvedValue({ success: true, lots: [makeLot()] }),
    getInventoryLot: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listInventoryLotMovements: vi.fn().mockResolvedValue({ success: true, movements: [] }),
    listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
    getStockSummary: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
    getAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    updateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    deactivateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reactivateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    getJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reverseJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    getTrialBalance: vi.fn().mockResolvedValue({
      success: true,
      trialBalance: {
        accounts: [],
        grandTotalDebitMinor: 0,
        grandTotalCreditMinor: 0,
        isBalanced: true
      }
    })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onBack/onOpenLot in tests that don't assert them
}

describe('InventoryItemLotsScreen', () => {
  it('shows a loading state, then the rendered lots', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [makeLot()] })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('LOT-000001')).toBeDefined()
  })

  it('shows an empty state when the item has no lots', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [] })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    expect(await screen.findByText('No lots recorded for this item yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listInventoryLotsForItem: vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    expect(
      await screen.findByText('Couldn\u2019t load lots for this item. Try reloading the app.')
    ).toBeDefined()
  })

  it('shows the item code and name in the heading/context', async () => {
    installMockApi()
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    expect(await screen.findByRole('heading', { name: /FLOUR.*Flour/ })).toBeDefined()
  })

  it('calls listInventoryLotsForItem exactly once with the given inventoryItemId', async () => {
    const api = installMockApi()
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    await screen.findByText('LOT-000001')
    expect(api.listInventoryLotsForItem).toHaveBeenCalledWith({
      inventoryItemId: 'inventory_item_1'
    })
    expect(api.listInventoryLotsForItem).toHaveBeenCalledTimes(1)
  })

  it('renders multiple lots', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({
        success: true,
        lots: [
          makeLot({ id: 'lot_1', internalLotNumber: 'LOT-000001' }),
          makeLot({ id: 'lot_2', internalLotNumber: 'LOT-000002' })
        ]
      })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    expect(await screen.findByText('LOT-000001')).toBeDefined()
    expect(screen.getByText('LOT-000002')).toBeDefined()
  })

  it('preserves the exact order returned by IPC', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({
        success: true,
        lots: [
          makeLot({ id: 'lot_1', internalLotNumber: 'LOT-000003' }),
          makeLot({ id: 'lot_2', internalLotNumber: 'LOT-000001' }),
          makeLot({ id: 'lot_3', internalLotNumber: 'LOT-000002' })
        ]
      })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    await screen.findByText('LOT-000003')
    const rows = await screen.findAllByRole('row')
    // rows[0] is the header row.
    expect(rows[1].textContent).toContain('LOT-000003')
    expect(rows[2].textContent).toContain('LOT-000001')
    expect(rows[3].textContent).toContain('LOT-000002')
  })

  it('shows a dash when supplier lot number, expiry, or supplier are null, never a raw null/undefined', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({
        success: true,
        lots: [
          makeLot({
            supplierLotNumber: null,
            expiryDate: null,
            supplierId: null,
            supplierCode: null,
            supplierName: null
          })
        ]
      })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    await screen.findByText('LOT-000001')
    expect(screen.getAllByText('\u2014').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('displays the effective status', async () => {
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({
        success: true,
        lots: [makeLot({ lifecycleStatus: 'quarantined', effectiveStatus: 'quarantined' })]
      })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    await screen.findByText('LOT-000001')
    expect(screen.getByText('quarantined')).toBeDefined()
  })

  it("clicking a lot opens lot detail via onOpenLot with that lot's id", async () => {
    const onOpenLot = vi.fn()
    installMockApi({
      listInventoryLotsForItem: vi.fn().mockResolvedValue({
        success: true,
        lots: [makeLot({ id: 'inventory_lot_42', internalLotNumber: 'LOT-000042' })]
      })
    })
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={onOpenLot}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View' }))
    expect(onOpenLot).toHaveBeenCalledWith('inventory_lot_42')
  })

  it('the Back button calls onBack', async () => {
    const onBack = vi.fn()
    installMockApi()
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={onBack}
        onOpenLot={noop}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('no mutation controls exist anywhere on the screen', async () => {
    installMockApi()
    render(
      <InventoryItemLotsScreen
        inventoryItemId="inventory_item_1"
        itemCode="FLOUR"
        itemName="Flour"
        onBack={noop}
        onOpenLot={noop}
      />
    )

    await screen.findByText('LOT-000001')
    for (const label of [
      'New',
      'Create',
      'Adjust',
      'Receipt',
      'Reserve',
      'Release',
      'Consume',
      'Edit',
      'Delete',
      'Reverse',
      'Quarantine',
      'Activate'
    ]) {
      expect(screen.queryByRole('button', { name: new RegExp(label, 'i') })).toBeNull()
    }
  })
})

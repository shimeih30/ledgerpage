// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { InventoryLotDetailScreen } from '../../src/renderer/src/inventory/InventoryLotDetailScreen'
import type { SafeInventoryLot, SafeStockMovement } from '../../src/shared/ipc/inventoryLots'

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

function makeMovement(overrides: Partial<SafeStockMovement> = {}): SafeStockMovement {
  return {
    id: 'stock_movement_1',
    inventoryLotId: 'inventory_lot_1',
    movementType: 'receipt',
    physicalQuantityDeltaScaled: 20000,
    reservedQuantityDeltaScaled: 0,
    formattedPhysicalQuantityDelta: '20.000',
    formattedReservedQuantityDelta: '0.000',
    costDeltaMinor: 7000,
    referenceType: 'opening_stock',
    referenceId: null,
    reversedMovementId: null,
    reason: null,
    createdAt: new Date('2026-01-01').getTime(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    getInventoryLot?: ReturnType<typeof vi.fn>
    listInventoryLotMovements?: ReturnType<typeof vi.fn>
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
    listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [] }),
    getInventoryLot:
      overrides.getInventoryLot ?? vi.fn().mockResolvedValue({ success: true, lot: makeLot() }),
    listInventoryLotMovements:
      overrides.listInventoryLotMovements ??
      vi.fn().mockResolvedValue({ success: true, movements: [makeMovement()] }),
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
  // used as onBack in tests that don't assert it
}

describe('InventoryLotDetailScreen', () => {
  it('shows a loading state, then the rendered metadata', async () => {
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByRole('heading', { name: 'LOT-000001' })).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    expect(
      await screen.findByText('Couldn\u2019t load this lot. Try reloading the app.')
    ).toBeDefined()
  })

  it('renders all core metadata fields', async () => {
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getByText('ACME-SL-1')).toBeDefined()
    expect(screen.getByText(/FLOUR/)).toBeDefined()
    expect(screen.getByText(/SUP-000001/)).toBeDefined()
    expect(screen.getAllByText(/kg/).length).toBeGreaterThan(0)
  })

  it('shows a dash when supplier is null, never a raw null/undefined', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({
        success: true,
        lot: makeLot({ supplierId: null, supplierCode: null, supplierName: null })
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getAllByText('\u2014').length).toBeGreaterThan(0)
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('shows the "active" effective status', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({
        success: true,
        lot: makeLot({ lifecycleStatus: 'active', effectiveStatus: 'active' })
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getByText('active')).toBeDefined()
  })

  it('shows the "expired" effective status', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({
        success: true,
        lot: makeLot({
          lifecycleStatus: 'active',
          effectiveStatus: 'expired',
          expiryDate: new Date('2020-01-01').getTime()
        })
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getByText('expired')).toBeDefined()
  })

  it('shows the "quarantined" status', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({
        success: true,
        lot: makeLot({ lifecycleStatus: 'quarantined', effectiveStatus: 'quarantined' })
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getByText('quarantined')).toBeDefined()
  })

  it('shows the "depleted" status', async () => {
    installMockApi({
      getInventoryLot: vi.fn().mockResolvedValue({
        success: true,
        lot: makeLot({
          lifecycleStatus: 'depleted',
          effectiveStatus: 'depleted',
          quantityRemainingScaled: 0,
          formattedQuantityRemaining: '0.000',
          costRemainingMinor: 0
        })
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getByText('depleted')).toBeDefined()
  })

  it('renders formatted quantities', async () => {
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(screen.getAllByText(/20\.000/).length).toBeGreaterThan(0)
  })

  it('renders formatted costs using en-ZW currency presentation', async () => {
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    // en-ZW formats USD as "US$X.XX"
    expect(screen.getAllByText(/US\$3\.50/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/US\$70\.00/).length).toBeGreaterThan(0)
  })

  it('renders movement rows', async () => {
    installMockApi({
      listInventoryLotMovements: vi.fn().mockResolvedValue({
        success: true,
        movements: [makeMovement({ id: 'mv_1', movementType: 'receipt' })]
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(await screen.findByText('receipt')).toBeDefined()
  })

  it('shows an empty movement history state', async () => {
    installMockApi({
      listInventoryLotMovements: vi.fn().mockResolvedValue({ success: true, movements: [] })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(await screen.findByText('No movements recorded yet.')).toBeDefined()
  })

  it('shows a reversal reference clearly', async () => {
    installMockApi({
      listInventoryLotMovements: vi.fn().mockResolvedValue({
        success: true,
        movements: [
          makeMovement({ id: 'mv_original', movementType: 'adjustment' }),
          makeMovement({
            id: 'mv_reversal',
            movementType: 'reversal',
            reversedMovementId: 'mv_original',
            reason: 'Undo mistaken adjustment'
          })
        ]
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(await screen.findByText('mv_original')).toBeDefined()
    expect(screen.getByText('Undo mistaken adjustment')).toBeDefined()
  })

  it('preserves the exact movement order returned by IPC', async () => {
    installMockApi({
      listInventoryLotMovements: vi.fn().mockResolvedValue({
        success: true,
        movements: [
          makeMovement({ id: 'mv_1', movementType: 'receipt' }),
          makeMovement({ id: 'mv_2', movementType: 'consumption' }),
          makeMovement({ id: 'mv_3', movementType: 'adjustment' })
        ]
      })
    })
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    const rows = await screen.findAllByRole('row')
    // rows[0] is the header row.
    expect(rows[1].textContent).toContain('receipt')
    expect(rows[2].textContent).toContain('consumption')
    expect(rows[3].textContent).toContain('adjustment')
  })

  it('no mutation control (edit/delete/reverse/quarantine/activate) exists anywhere on the screen', async () => {
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    for (const label of [
      'Edit',
      'Delete',
      'Reverse',
      'Quarantine',
      'Activate',
      'Adjust',
      'Create'
    ]) {
      expect(screen.queryByRole('button', { name: new RegExp(label, 'i') })).toBeNull()
    }
  })

  it('calls only getInventoryLot and listInventoryLotMovements -- no mutation IPC method', async () => {
    const api = installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={noop} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    expect(api.getInventoryLot).toHaveBeenCalledWith({ lotId: 'inventory_lot_1' })
    expect(api.listInventoryLotMovements).toHaveBeenCalledWith({ lotId: 'inventory_lot_1' })
  })

  it('the Back button is present and calls onBack', async () => {
    const onBack = vi.fn()
    installMockApi()
    render(<InventoryLotDetailScreen lotId="inventory_lot_1" onBack={onBack} />)

    await screen.findByRole('heading', { name: 'LOT-000001' })
    screen.getByRole('button', { name: 'Back' }).click()
    expect(onBack).toHaveBeenCalled()
  })
})

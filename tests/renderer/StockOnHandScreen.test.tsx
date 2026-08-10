// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StockOnHandScreen } from '../../src/renderer/src/inventory/StockOnHandScreen'
import type { SafeStockSummary } from '../../src/shared/ipc/inventoryLots'

afterEach(() => {
  cleanup()
})

function makeSummary(overrides: Partial<SafeStockSummary> = {}): SafeStockSummary {
  return {
    inventoryItemId: 'inventory_item_1',
    itemCode: 'FLOUR',
    itemName: 'Flour',
    unitCode: 'kg',
    unitName: 'Kilogram',
    decimalPlaces: 3,
    physicalQuantityScaled: 20000,
    reservedQuantityScaled: 5000,
    availableQuantityScaled: 15000,
    incomingQuantityScaled: 0,
    formattedPhysicalQuantity: '20.000',
    formattedReservedQuantity: '5.000',
    formattedAvailableQuantity: '15.000',
    formattedIncomingQuantity: '0.000',
    lotCount: 2,
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listStockSummaries?: ReturnType<typeof vi.fn>
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
    listInventoryLotsForItem: vi.fn(),
    getInventoryLot: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listInventoryLotMovements: vi.fn().mockResolvedValue({ success: true, movements: [] }),
    listStockSummaries:
      overrides.listStockSummaries ?? vi.fn().mockResolvedValue({ success: true, summaries: [] }),
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
  // used as onOpenItemLots in tests that don't assert it
}

describe('StockOnHandScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('FLOUR')).toBeDefined()
    expect(screen.getByText('Flour')).toBeDefined()
  })

  it('shows an empty state when there is no stock on hand', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [] })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    expect(await screen.findByText('No stock on hand yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listStockSummaries: vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    expect(
      await screen.findByText('Couldn\u2019t load stock on hand. Try reloading the app.')
    ).toBeDefined()
  })

  it('renders formatted quantities for physical/reserved/available/incoming', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    await screen.findByText('FLOUR')
    expect(screen.getByText('20.000')).toBeDefined()
    expect(screen.getByText('5.000')).toBeDefined()
    expect(screen.getByText('15.000')).toBeDefined()
  })

  it('incoming displays zero correctly, formatted', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({
        success: true,
        summaries: [makeSummary({ incomingQuantityScaled: 0, formattedIncomingQuantity: '0.000' })]
      })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    await screen.findByText('FLOUR')
    expect(screen.getByText('0.000')).toBeDefined()
  })

  describe('search', () => {
    const flour = makeSummary({
      inventoryItemId: 'inventory_item_1',
      itemCode: 'FLOUR',
      itemName: 'Flour'
    })
    const sugar = makeSummary({
      inventoryItemId: 'inventory_item_2',
      itemCode: 'SUGAR',
      itemName: 'Sugar'
    })

    it('searches by code (case-insensitive)', async () => {
      installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [flour, sugar] })
      })
      render(<StockOnHandScreen onOpenItemLots={noop} />)

      await screen.findByText('FLOUR')
      fireEvent.change(screen.getByLabelText('Search stock'), { target: { value: 'sugar' } })
      expect(screen.queryByText('FLOUR')).toBeNull()
      expect(screen.getByText('SUGAR')).toBeDefined()
    })

    it('searches by name (case-insensitive)', async () => {
      installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [flour, sugar] })
      })
      render(<StockOnHandScreen onOpenItemLots={noop} />)

      await screen.findByText('FLOUR')
      fireEvent.change(screen.getByLabelText('Search stock'), { target: { value: 'SUGAR' } })
      expect(screen.queryByText('Flour')).toBeNull()
      expect(screen.getByText('Sugar')).toBeDefined()
    })

    it('shows a no-results state for a query matching nothing', async () => {
      installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [flour, sugar] })
      })
      render(<StockOnHandScreen onOpenItemLots={noop} />)

      await screen.findByText('FLOUR')
      fireEvent.change(screen.getByLabelText('Search stock'), {
        target: { value: 'zzz-no-match' }
      })
      expect(await screen.findByText(/No items match/)).toBeDefined()
    })

    it('clearing the search restores all rows', async () => {
      installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [flour, sugar] })
      })
      render(<StockOnHandScreen onOpenItemLots={noop} />)

      await screen.findByText('FLOUR')
      const searchInput = screen.getByLabelText('Search stock')
      fireEvent.change(searchInput, { target: { value: 'SUGAR' } })
      expect(screen.queryByText('FLOUR')).toBeNull()

      fireEvent.change(searchInput, { target: { value: '' } })
      expect(screen.getByText('FLOUR')).toBeDefined()
      expect(screen.getByText('SUGAR')).toBeDefined()
    })
  })

  it('no mutation controls exist anywhere on the screen', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    await screen.findByText('FLOUR')
    for (const label of [
      'New',
      'Create',
      'Adjust',
      'Receipt',
      'Reserve',
      'Release',
      'Consume',
      'Edit',
      'Delete'
    ]) {
      expect(screen.queryByRole('button', { name: new RegExp(label, 'i') })).toBeNull()
    }
  })

  it('Finance receives the same read-only view -- no props gate any control', async () => {
    installMockApi({
      listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
    })
    render(<StockOnHandScreen onOpenItemLots={noop} />)

    await screen.findByText('FLOUR')
    // StockOnHandScreen accepts no capability props at all -- the same
    // read-only surface renders regardless of role, confirming there is
    // no hidden manager-only control to gate.
    expect(screen.getByRole('button', { name: 'View lots' })).toBeDefined()
  })

  describe('this screen calls only listStockSummaries', () => {
    it('never calls listInventoryLotsForItem, getInventoryLot or listInventoryLotMovements', async () => {
      const api = installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
      })
      render(<StockOnHandScreen onOpenItemLots={noop} />)

      await screen.findByText('FLOUR')
      expect(api.listInventoryLotsForItem).not.toHaveBeenCalled()
      expect(api.getInventoryLot).not.toHaveBeenCalled()
      expect(api.listInventoryLotMovements).not.toHaveBeenCalled()
    })
  })

  describe('row navigation', () => {
    it('clicking a summary\u2019s "View lots" navigates directly to item-lots -- no IPC call, no arbitrary lot selection', async () => {
      const onOpenItemLots = vi.fn()
      const api = installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
      })
      render(<StockOnHandScreen onOpenItemLots={onOpenItemLots} />)

      fireEvent.click(await screen.findByRole('button', { name: 'View lots' }))

      expect(onOpenItemLots).toHaveBeenCalledWith('inventory_item_1', 'FLOUR', 'Flour')
      expect(onOpenItemLots).toHaveBeenCalledTimes(1)
      expect(api.listInventoryLotsForItem).not.toHaveBeenCalled()
    })

    it('rapid repeated clicks each synchronously invoke the callback -- there is no IPC round-trip to guard against', async () => {
      const onOpenItemLots = vi.fn()
      installMockApi({
        listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [makeSummary()] })
      })
      render(<StockOnHandScreen onOpenItemLots={onOpenItemLots} />)

      const button = await screen.findByRole('button', { name: 'View lots' })
      fireEvent.click(button)
      fireEvent.click(button)

      // Navigation is a synchronous prop callback, not an IPC call, so
      // there is nothing to debounce -- each click is a legitimate,
      // independent navigation intent (e.g. the shell may choose to
      // reset local state on each call).
      expect(onOpenItemLots).toHaveBeenCalledTimes(2)
    })
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomerListScreen } from '../../src/renderer/src/customers/CustomerListScreen'
import type { SafeCustomer } from '../../src/shared/ipc/customers'

afterEach(() => {
  cleanup()
})

function makeCustomer(overrides: Partial<SafeCustomer> = {}): SafeCustomer {
  return {
    id: 'customer_1',
    code: 'CUS-000001',
    name: 'Acme Retail',
    contactDetails: 'buyer@acme.com',
    paymentTermsDays: null,
    creditLimitMinor: null,
    currencyId: 'currency_usd',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listCustomers?: ReturnType<typeof vi.fn>
    deactivateCustomer?: ReturnType<typeof vi.fn>
    reactivateCustomer?: ReturnType<typeof vi.fn>
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
    listCustomers:
      overrides.listCustomers ?? vi.fn().mockResolvedValue({ success: true, customers: [] }),
    getCustomer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deactivateCustomer: overrides.deactivateCustomer ?? vi.fn(),
    reactivateCustomer: overrides.reactivateCustomer ?? vi.fn(),
    listContactsForCustomer: vi.fn(),
    getCustomerContact: vi.fn(),
    createCustomerContact: vi.fn(),
    updateCustomerContact: vi.fn(),
    deactivateCustomerContact: vi.fn(),
    reactivateCustomerContact: vi.fn(),
    listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [] }),
    getInventoryLot: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listInventoryLotMovements: vi.fn().mockResolvedValue({ success: true, movements: [] }),
    listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
    getStockSummary: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onOpenCustomer/onCreateCustomer in tests that don't assert them
}

describe('CustomerListScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [makeCustomer()] })
    })
    render(<CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('CUS-000001')).toBeDefined()
    expect(screen.getByText('Acme Retail')).toBeDefined()
    expect(screen.getByText('buyer@acme.com')).toBeDefined()
  })

  it('shows an empty state when there are no customers', async () => {
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [] })
    })
    render(<CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />)

    expect(await screen.findByText('No customers yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />)

    expect(
      await screen.findByText('Couldn\u2019t load customers. Try reloading the app.')
    ).toBeDefined()
  })

  it('displays a dash when contact details are null, never a raw null/undefined', async () => {
    installMockApi({
      listCustomers: vi
        .fn()
        .mockResolvedValue({ success: true, customers: [makeCustomer({ contactDetails: null })] })
    })
    render(<CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />)

    await screen.findByText('CUS-000001')
    expect(screen.getByText('\u2014')).toBeDefined()
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  describe('search', () => {
    const acme = makeCustomer({
      id: 'customer_1',
      code: 'CUS-000001',
      name: 'Acme Retail',
      contactDetails: 'buyer@acme.com'
    })
    const beta = makeCustomer({
      id: 'customer_2',
      code: 'CUS-000002',
      name: 'Beta Traders',
      contactDetails: 'orders@beta.example'
    })

    it('searches by code (case-insensitive)', async () => {
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [acme, beta] })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      fireEvent.change(screen.getByLabelText('Search customers'), {
        target: { value: 'cus-000002' }
      })
      expect(screen.queryByText('CUS-000001')).toBeNull()
      expect(screen.getByText('CUS-000002')).toBeDefined()
    })

    it('searches by name (case-insensitive)', async () => {
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [acme, beta] })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'BETA' } })
      expect(screen.queryByText('Acme Retail')).toBeNull()
      expect(screen.getByText('Beta Traders')).toBeDefined()
    })

    it('searches by contact details (case-insensitive)', async () => {
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [acme, beta] })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      fireEvent.change(screen.getByLabelText('Search customers'), {
        target: { value: 'ORDERS@BETA' }
      })
      expect(screen.queryByText('Acme Retail')).toBeNull()
      expect(screen.getByText('Beta Traders')).toBeDefined()
    })

    it('shows a no-results state for a query matching nothing', async () => {
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [acme, beta] })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      fireEvent.change(screen.getByLabelText('Search customers'), {
        target: { value: 'zzz-no-match' }
      })
      expect(await screen.findByText(/No customers match/)).toBeDefined()
    })

    it('clearing the search restores all rows', async () => {
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [acme, beta] })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      const searchInput = screen.getByLabelText('Search customers')
      fireEvent.change(searchInput, { target: { value: 'BETA' } })
      expect(screen.queryByText('Acme Retail')).toBeNull()

      fireEvent.change(searchInput, { target: { value: '' } })
      expect(screen.getByText('Acme Retail')).toBeDefined()
      expect(screen.getByText('Beta Traders')).toBeDefined()
    })
  })

  it('a manager sees New customer and mutation actions', async () => {
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [makeCustomer()] })
    })
    render(<CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />)

    await screen.findByText('CUS-000001')
    expect(screen.getByRole('button', { name: 'New customer' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDefined()
  })

  it('canManageCustomers=false (defensive test even though all current roles manage) shows no New customer button and only a View action', async () => {
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [makeCustomer()] })
    })
    render(
      <CustomerListScreen
        canManageCustomers={false}
        onOpenCustomer={noop}
        onCreateCustomer={noop}
      />
    )

    await screen.findByText('CUS-000001')
    expect(screen.queryByRole('button', { name: 'New customer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
  })

  it('opening details invokes onOpenCustomer with the customer id', async () => {
    const onOpenCustomer = vi.fn()
    installMockApi({
      listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [makeCustomer()] })
    })
    render(
      <CustomerListScreen
        canManageCustomers
        onOpenCustomer={onOpenCustomer}
        onCreateCustomer={noop}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(onOpenCustomer).toHaveBeenCalledWith('customer_1')
  })

  describe('deactivate/reactivate: authoritative refresh, never optimistic', () => {
    it('waits for IPC success before changing visible state, then reloads from a fresh listCustomers call', async () => {
      const listCustomers = vi
        .fn()
        .mockResolvedValueOnce({ success: true, customers: [makeCustomer({ isActive: true })] })
        .mockResolvedValueOnce({
          success: true,
          customers: [makeCustomer({ isActive: false })]
        })
      const deactivateCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: false }) })
      installMockApi({ listCustomers, deactivateCustomer })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await waitFor(() => expect(listCustomers).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Inactive')).toBeDefined()
    })

    it('a failed mutation leaves the existing row unchanged -- no second listCustomers call', async () => {
      const listCustomers = vi
        .fn()
        .mockResolvedValue({ success: true, customers: [makeCustomer({ isActive: true })] })
      const deactivateCustomer = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ listCustomers, deactivateCustomer })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await screen.findByText('Something went wrong. Try again.')
      expect(screen.getByText('Active')).toBeDefined()
      expect(listCustomers).toHaveBeenCalledTimes(1)
    })

    it('repeated rapid clicks while a mutation is in flight produce exactly one IPC call', async () => {
      let resolveDeactivate: (value: unknown) => void = () => {}
      const deactivateCustomer = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDeactivate = resolve
        })
      )
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [makeCustomer()] }),
        deactivateCustomer
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('Active')
      const button = screen.getByRole('button', { name: 'Deactivate' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(deactivateCustomer).toHaveBeenCalledTimes(1)
      resolveDeactivate({ success: true, customer: makeCustomer({ isActive: false }) })
    })
  })

  describe('scale sanity check', () => {
    it('renders and searches a list of roughly 500 customers without error', async () => {
      const manyCustomers = Array.from({ length: 500 }, (_, i) =>
        makeCustomer({
          id: `customer_${i}`,
          code: `CUS-${String(i + 1).padStart(6, '0')}`,
          name: `Customer ${i}`,
          contactDetails: `contact${i}@example.com`
        })
      )
      installMockApi({
        listCustomers: vi.fn().mockResolvedValue({ success: true, customers: manyCustomers })
      })
      render(
        <CustomerListScreen canManageCustomers onOpenCustomer={noop} onCreateCustomer={noop} />
      )

      await screen.findByText('CUS-000001')
      expect(screen.getByText('Customer 499')).toBeDefined()

      fireEvent.change(screen.getByLabelText('Search customers'), {
        target: { value: 'Customer 250' }
      })
      expect(await screen.findByText('CUS-000251')).toBeDefined()
      expect(screen.queryByText('CUS-000001')).toBeNull()
    })
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UsersAndRolesScreen } from '../../src/renderer/src/users/UsersAndRolesScreen'
import type {
  CreateUserResult,
  ListUsersResult,
  MutateUserResult
} from '../../src/shared/ipc/users'

afterEach(() => {
  cleanup()
})

const OWNER_ROW = {
  id: 'user_owner',
  loginIdentifier: 'ben',
  displayName: 'Ben',
  isActive: true,
  roleCode: 'owner'
}
const FINANCE_ROW = {
  id: 'user_finance',
  loginIdentifier: 'financeuser',
  displayName: 'Finance Person',
  isActive: true,
  roleCode: 'finance'
}

function installMockApi(overrides: {
  listUsers?: () => Promise<ListUsersResult>
  createUser?: () => Promise<CreateUserResult>
  deactivateUser?: () => Promise<MutateUserResult>
  reactivateUser?: () => Promise<MutateUserResult>
}): void {
  window.ledgerpage = {
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
    listUsers:
      overrides.listUsers ??
      vi.fn().mockResolvedValue({ success: true, users: [OWNER_ROW, FINANCE_ROW] }),
    createUser: overrides.createUser ?? vi.fn().mockResolvedValue({ success: true }),
    deactivateUser: overrides.deactivateUser ?? vi.fn().mockResolvedValue({ success: true }),
    reactivateUser: overrides.reactivateUser ?? vi.fn().mockResolvedValue({ success: true }),
    listAssignableRoles: vi.fn().mockResolvedValue({
      success: true,
      roles: [
        { code: 'executive', name: 'Executive' },
        { code: 'operations', name: 'Operations' },
        { code: 'finance', name: 'Finance' }
      ]
    }),
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
    listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] }),
    listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [] }),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: vi.fn(),
    reactivateInventoryItem: vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn().mockResolvedValue({ success: true, units: [] }),
    listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [] }),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: vi.fn(),
    reactivateSupplier: vi.fn(),
    recordSupplierPrice: vi.fn(),
    listPricesForSupplier: vi.fn().mockResolvedValue({ success: true, prices: [] }),
    listPricesForInventoryItem: vi.fn().mockResolvedValue({ success: true, prices: [] }),
    getCurrentSupplierItemPrice: vi.fn().mockResolvedValue({ success: true, price: null }),
    listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [] }),
    getCustomer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deactivateCustomer: vi.fn(),
    reactivateCustomer: vi.fn(),
    listContactsForCustomer: vi.fn().mockResolvedValue({ success: true, contacts: [] }),
    getCustomerContact: vi.fn(),
    createCustomerContact: vi.fn(),
    updateCustomerContact: vi.fn(),
    deactivateCustomerContact: vi.fn(),
    reactivateCustomerContact: vi.fn(),
    listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [] }),
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
}

describe('UsersAndRolesScreen', () => {
  it('shows a loading state, then the user list', async () => {
    installMockApi({})
    render(<UsersAndRolesScreen />)

    expect(await screen.findByText('Ben')).toBeDefined()
    expect(screen.getByText('Finance Person')).toBeDefined()
    expect(screen.getByText('owner')).toBeDefined()
    expect(screen.getByText('finance')).toBeDefined()
  })

  it('shows an error state if listUsers fails', async () => {
    installMockApi({
      listUsers: () => Promise.resolve({ success: false, errorCode: 'not_authorized' })
    })
    render(<UsersAndRolesScreen />)

    expect(
      await screen.findByText('Couldn\u2019t load users. Try reloading the app.')
    ).toBeDefined()
  })

  it('the Owner row has no deactivate/reactivate button', async () => {
    installMockApi({})
    render(<UsersAndRolesScreen />)
    await screen.findByText('Ben')

    const rows = screen.getAllByRole('row')
    const ownerRow = rows.find((row) => row.textContent?.includes('Ben'))
    expect(ownerRow?.textContent).not.toContain('Deactivate')
    expect(ownerRow?.textContent).not.toContain('Reactivate')
  })

  it('the Finance row has a Deactivate button that calls deactivateUser and reloads', async () => {
    const deactivateUser = vi.fn().mockResolvedValue({ success: true })
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ success: true, users: [OWNER_ROW, FINANCE_ROW] })
      .mockResolvedValueOnce({
        success: true,
        users: [OWNER_ROW, { ...FINANCE_ROW, isActive: false }]
      })
    installMockApi({ deactivateUser, listUsers })
    const user = userEvent.setup()
    render(<UsersAndRolesScreen />)
    await screen.findByText('Finance Person')

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(deactivateUser).toHaveBeenCalledWith({ userId: 'user_finance' })
    expect(await screen.findByText('Deactivated')).toBeDefined()
  })

  it('a deactivated user shows a Reactivate button that calls reactivateUser', async () => {
    const reactivateUser = vi.fn().mockResolvedValue({ success: true })
    installMockApi({
      listUsers: () =>
        Promise.resolve({
          success: true,
          users: [OWNER_ROW, { ...FINANCE_ROW, isActive: false }]
        }),
      reactivateUser
    })
    const user = userEvent.setup()
    render(<UsersAndRolesScreen />)
    await screen.findByText('Finance Person')

    await user.click(screen.getByRole('button', { name: 'Reactivate' }))

    expect(reactivateUser).toHaveBeenCalledWith({ userId: 'user_finance' })
  })

  it('a mutation failure shows a mapped, safe error message', async () => {
    installMockApi({
      deactivateUser: () => Promise.resolve({ success: false, errorCode: 'cannot_modify_owner' })
    })
    const user = userEvent.setup()
    render(<UsersAndRolesScreen />)
    await screen.findByText('Finance Person')

    await user.click(screen.getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByText('The Owner account can\u2019t be changed here.')).toBeDefined()
  })

  describe('Add user flow', () => {
    it('clicking "Add user" reveals the create-user form, populated with roles from listAssignableRoles', async () => {
      installMockApi({})
      const user = userEvent.setup()
      render(<UsersAndRolesScreen />)
      await screen.findByText('Ben')

      await user.click(screen.getByRole('button', { name: 'Add user' }))

      expect(await screen.findByLabelText('Name')).toBeDefined()
      expect(screen.getByRole('option', { name: 'Finance' })).toBeDefined()
    })

    it('a successful creation hides the form and reloads the list', async () => {
      const createUser = vi.fn().mockResolvedValue({ success: true })
      const listUsers = vi
        .fn()
        .mockResolvedValueOnce({ success: true, users: [OWNER_ROW] })
        .mockResolvedValueOnce({ success: true, users: [OWNER_ROW, FINANCE_ROW] })
      installMockApi({ createUser, listUsers })
      const user = userEvent.setup()
      render(<UsersAndRolesScreen />)
      await screen.findByText('Ben')

      await user.click(screen.getByRole('button', { name: 'Add user' }))
      await screen.findByLabelText('Name')

      await user.type(screen.getByLabelText('Name'), 'Finance Person')
      await user.type(screen.getByLabelText('Username'), 'financeuser')
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password-1')
      await user.click(screen.getByRole('button', { name: 'Create user' }))

      expect(createUser).toHaveBeenCalledWith({
        displayName: 'Finance Person',
        loginIdentifier: 'financeuser',
        password: 'a-strong-password-1',
        passwordConfirmation: 'a-strong-password-1',
        roleCode: 'executive'
      })
      expect(await screen.findByText('Finance Person')).toBeDefined()
      expect(screen.queryByLabelText('Name')).toBeNull()
    })

    it('cannot submit the create-user form with mismatched passwords', async () => {
      const createUser = vi.fn().mockResolvedValue({ success: true })
      installMockApi({ createUser })
      const user = userEvent.setup()
      render(<UsersAndRolesScreen />)
      await screen.findByText('Ben')

      await user.click(screen.getByRole('button', { name: 'Add user' }))
      await screen.findByLabelText('Name')

      await user.type(screen.getByLabelText('Name'), 'Finance Person')
      await user.type(screen.getByLabelText('Username'), 'financeuser')
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.type(screen.getByLabelText('Confirm password'), 'a-different-password-2')

      expect(screen.getByText('Passwords don\u2019t match.')).toBeDefined()
      expect(screen.getByRole('button', { name: 'Create user' }).hasAttribute('disabled')).toBe(
        true
      )
      expect(createUser).not.toHaveBeenCalled()
    })

    it('"Cancel" hides the create-user form without submitting', async () => {
      installMockApi({})
      const user = userEvent.setup()
      render(<UsersAndRolesScreen />)
      await screen.findByText('Ben')

      await user.click(screen.getByRole('button', { name: 'Add user' }))
      await screen.findByLabelText('Name')
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.queryByLabelText('Name')).toBeNull()
      expect(screen.getByRole('button', { name: 'Add user' })).toBeDefined()
    })
  })
})

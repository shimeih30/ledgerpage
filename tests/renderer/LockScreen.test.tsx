// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LockScreen } from '../../src/renderer/src/auth/LockScreen'
import type { UnlockResult } from '../../src/shared/ipc/login'

afterEach(() => {
  cleanup()
})

function installMockApi(unlockSession: () => Promise<UnlockResult>): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState: vi.fn(),
    unlockSession,
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

describe('LockScreen', () => {
  it('shows only the signed-in user\u2019s name — never a username field', () => {
    installMockApi(vi.fn())
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    expect(screen.getByText('Welcome back, Ben')).toBeDefined()
    expect(screen.queryByLabelText('Username')).toBeNull()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  it('calls onUnlocked with the session on a correct password', async () => {
    installMockApi(() =>
      Promise.resolve({
        success: true,
        session: {
          displayName: 'Ben',
          isOwner: true,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: true,
          canViewInventoryItems: true,
          canManageInventoryItems: true,
          canViewSuppliers: true,
          canManageSuppliers: true,
          canViewCustomers: true,
          canManageCustomers: true,
          canViewInventoryLots: true,
          canManageInventoryLots: true,
          canOverrideInventoryLots: true,
          canViewAccounts: true,
          canManageAccounts: true,
          canViewJournalEntries: true,
          canManageJournalEntries: true
        }
      })
    )
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(onUnlocked).toHaveBeenCalledWith({
      displayName: 'Ben',
      isOwner: true,
      canViewAuditLog: true,
      canViewProducts: true,
      canManageProducts: true,
      canViewInventoryItems: true,
      canManageInventoryItems: true,
      canViewSuppliers: true,
      canManageSuppliers: true,
      canViewCustomers: true,
      canManageCustomers: true,
      canViewInventoryLots: true,
      canManageInventoryLots: true,
      canOverrideInventoryLots: true,
      canViewAccounts: true,
      canManageAccounts: true,
      canViewJournalEntries: true,
      canManageJournalEntries: true
    })
  })

  it('a wrong password shows an inline error, clears the field, and allows retry', async () => {
    const unlockSession = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({
        success: true,
        session: {
          displayName: 'Ben',
          isOwner: true,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: true,
          canViewInventoryItems: true,
          canManageInventoryItems: true,
          canViewSuppliers: true,
          canManageSuppliers: true,
          canViewCustomers: true,
          canManageCustomers: true,
          canViewInventoryLots: true,
          canManageInventoryLots: true,
          canOverrideInventoryLots: true,
          canViewAccounts: true,
          canManageAccounts: true,
          canViewJournalEntries: true,
          canManageJournalEntries: true
        }
      })
    installMockApi(unlockSession)
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That password isn\u2019t right. Try again.')).toBeDefined()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(onUnlocked).toHaveBeenCalledWith({
      displayName: 'Ben',
      isOwner: true,
      canViewAuditLog: true,
      canViewProducts: true,
      canManageProducts: true,
      canViewInventoryItems: true,
      canManageInventoryItems: true,
      canViewSuppliers: true,
      canManageSuppliers: true,
      canViewCustomers: true,
      canManageCustomers: true,
      canViewInventoryLots: true,
      canManageInventoryLots: true,
      canOverrideInventoryLots: true,
      canViewAccounts: true,
      canManageAccounts: true,
      canViewJournalEntries: true,
      canManageJournalEntries: true
    })
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolveUnlock!: (value: UnlockResult) => void
    const pending = new Promise<UnlockResult>((resolve) => {
      resolveUnlock = resolve
    })
    installMockApi(() => pending)
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const busyButton = await screen.findByRole('button', { name: 'Unlocking\u2026' })
    expect(busyButton.hasAttribute('disabled')).toBe(true)

    resolveUnlock({
      success: true,
      session: {
        displayName: 'Ben',
        isOwner: true,
        canViewAuditLog: true,
        canViewProducts: true,
        canManageProducts: true,
        canViewInventoryItems: true,
        canManageInventoryItems: true,
        canViewSuppliers: true,
        canManageSuppliers: true,
        canViewCustomers: true,
        canManageCustomers: true,
        canViewInventoryLots: true,
        canManageInventoryLots: true,
        canOverrideInventoryLots: true,
        canViewAccounts: true,
        canManageAccounts: true,
        canViewJournalEntries: true,
        canManageJournalEntries: true
      }
    })
  })

  it('a thrown IPC error shows a safe, generic message', async () => {
    installMockApi(() => Promise.reject(new Error('IPC failure')))
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('Something went wrong unlocking. Try again.')).toBeDefined()
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChartOfAccountsScreen } from '../../src/renderer/src/accounting/ChartOfAccountsScreen'
import type { SafeAccount } from '../../src/shared/ipc/accounting'

afterEach(() => {
  cleanup()
})

function makeAccount(overrides: Partial<SafeAccount> = {}): SafeAccount {
  return {
    id: 'account_1',
    code: '1000',
    name: 'Cash on Hand',
    category: 'asset',
    subtype: 'cash',
    normalBalance: 'debit',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listAccounts?: ReturnType<typeof vi.fn>
    createAccount?: ReturnType<typeof vi.fn>
    updateAccount?: ReturnType<typeof vi.fn>
    deactivateAccount?: ReturnType<typeof vi.fn>
    reactivateAccount?: ReturnType<typeof vi.fn>
  } = {}
) {
  const api = {
    listAccounts:
      overrides.listAccounts ?? vi.fn().mockResolvedValue({ success: true, accounts: [] }),
    getAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createAccount:
      overrides.createAccount ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    updateAccount:
      overrides.updateAccount ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    deactivateAccount:
      overrides.deactivateAccount ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reactivateAccount:
      overrides.reactivateAccount ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    getJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createJournalEntry: vi.fn(),
    reverseJournalEntry: vi.fn(),
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

describe('ChartOfAccountsScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] })
    })
    render(<ChartOfAccountsScreen canManageAccounts={false} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('1000')).toBeDefined()
    expect(screen.getByText('Cash on Hand')).toBeDefined()
  })

  it('shows an empty state when there are no accounts', async () => {
    installMockApi({ listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }) })
    render(<ChartOfAccountsScreen canManageAccounts={false} />)

    expect(await screen.findByText('No accounts yet.')).toBeDefined()
  })

  it('shows a safe error message on failure', async () => {
    installMockApi({
      listAccounts: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<ChartOfAccountsScreen canManageAccounts={false} />)

    expect(
      await screen.findByText('Couldn\u2019t load the chart of accounts. Try reloading the app.')
    ).toBeDefined()
  })

  describe('search', () => {
    const cash = makeAccount({ id: 'a1', code: '1000', name: 'Cash on Hand', subtype: 'cash' })
    const payable = makeAccount({
      id: 'a2',
      code: '2000',
      name: 'Accounts Payable',
      category: 'liability',
      subtype: 'accounts_payable',
      normalBalance: 'credit'
    })

    it('searches by code', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [cash, payable] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={false} />)

      await screen.findByText('1000')
      fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: '2000' } })
      expect(screen.queryByText('Cash on Hand')).toBeNull()
      expect(screen.getByText('Accounts Payable')).toBeDefined()
    })

    it('searches by name', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [cash, payable] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={false} />)

      await screen.findByText('1000')
      fireEvent.change(screen.getByLabelText('Search accounts'), { target: { value: 'payable' } })
      expect(screen.queryByText('1000')).toBeNull()
      expect(screen.getByText('2000')).toBeDefined()
    })

    it('searches by subtype', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [cash, payable] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={false} />)

      await screen.findByText('1000')
      fireEvent.change(screen.getByLabelText('Search accounts'), {
        target: { value: 'accounts_payable' }
      })
      expect(screen.queryByText('1000')).toBeNull()
      expect(screen.getByText('2000')).toBeDefined()
    })
  })

  it('inactive accounts remain visible', async () => {
    installMockApi({
      listAccounts: vi
        .fn()
        .mockResolvedValue({ success: true, accounts: [makeAccount({ isActive: false })] })
    })
    render(<ChartOfAccountsScreen canManageAccounts={false} />)

    await screen.findByText('1000')
    expect(screen.getByText('inactive')).toBeDefined()
  })

  describe('role-gated manage controls', () => {
    it('Owner/Finance (canManageAccounts=true) see New account, Edit, and Deactivate controls', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      expect(screen.getByRole('button', { name: 'New account' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
      expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDefined()
    })

    it('Executive (canManageAccounts=false) receives a read-only view -- no manage controls anywhere', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={false} />)

      await screen.findByText('1000')
      expect(screen.queryByRole('button', { name: 'New account' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
    })

    it('no delete/remove control exists anywhere, regardless of role', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    })
  })

  describe('create', () => {
    it('creating a valid account calls createAccount and refreshes the authoritative list afterward', async () => {
      const listAccounts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, accounts: [] })
        .mockResolvedValueOnce({ success: true, accounts: [makeAccount({ code: '7000' })] })
      const createAccount = vi
        .fn()
        .mockResolvedValue({ success: true, account: makeAccount({ code: '7000' }) })
      installMockApi({ listAccounts, createAccount })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('No accounts yet.')
      fireEvent.click(screen.getByRole('button', { name: 'New account' }))

      fireEvent.change(screen.getByLabelText('Code'), { target: { value: '7000' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Utilities' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'expense' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

      await waitFor(() => {
        expect(createAccount).toHaveBeenCalledWith({
          code: '7000',
          name: 'Utilities',
          category: 'expense',
          subtype: null
        })
      })
      expect(await screen.findByText('7000')).toBeDefined()
      expect(listAccounts).toHaveBeenCalledTimes(2)
    })

    it('the create form never applies an optimistic update -- the row only appears after the authoritative refresh resolves', async () => {
      let resolveRefresh: (value: unknown) => void = () => {}
      const listAccounts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, accounts: [] })
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveRefresh = resolve
          })
        )
      const createAccount = vi
        .fn()
        .mockResolvedValue({ success: true, account: makeAccount({ code: '7000' }) })
      installMockApi({ listAccounts, createAccount })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('No accounts yet.')
      fireEvent.click(screen.getByRole('button', { name: 'New account' }))
      fireEvent.change(screen.getByLabelText('Code'), { target: { value: '7000' } })
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Utilities' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

      await waitFor(() => expect(createAccount).toHaveBeenCalled())
      // Refresh has not resolved yet -- the new row must not be visible.
      expect(screen.queryByText('7000')).toBeNull()

      resolveRefresh({ success: true, accounts: [makeAccount({ code: '7000' })] })
      expect(await screen.findByText('7000')).toBeDefined()
    })
  })

  describe('edit', () => {
    it('the edit form allows only name and subtype -- no code or category field is rendered', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] })
      })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

      expect(screen.getByLabelText('Name')).toBeDefined()
      expect(screen.getByLabelText('Subtype (optional)')).toBeDefined()
      expect(screen.queryByLabelText('Code')).toBeNull()
      expect(screen.queryByLabelText('Category')).toBeNull()
    })

    it('submitting the edit form calls updateAccount with only id/name/subtype, and code/category remain unchanged', async () => {
      const listAccounts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, accounts: [makeAccount()] })
        .mockResolvedValueOnce({
          success: true,
          accounts: [makeAccount({ name: 'Petty Cash Drawer' })]
        })
      const updateAccount = vi
        .fn()
        .mockResolvedValue({ success: true, account: makeAccount({ name: 'Petty Cash Drawer' }) })
      installMockApi({ listAccounts, updateAccount })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Petty Cash Drawer' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

      await waitFor(() => {
        expect(updateAccount).toHaveBeenCalledWith({
          id: 'account_1',
          name: 'Petty Cash Drawer',
          subtype: 'cash'
        })
      })
      expect(await screen.findByText('Petty Cash Drawer')).toBeDefined()
      // The code and category are never sent by the edit form, and the
      // row's own code (fixed by the mock) remains unchanged.
      expect(screen.getByText('1000')).toBeDefined()
    })
  })

  describe('lifecycle', () => {
    it('clicking Deactivate calls deactivateAccount and refreshes', async () => {
      const listAccounts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, accounts: [makeAccount()] })
        .mockResolvedValueOnce({
          success: true,
          accounts: [makeAccount({ isActive: false })]
        })
      const deactivateAccount = vi
        .fn()
        .mockResolvedValue({ success: true, account: makeAccount({ isActive: false }) })
      installMockApi({ listAccounts, deactivateAccount })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await waitFor(() => expect(deactivateAccount).toHaveBeenCalledWith({ id: 'account_1' }))
      expect(await screen.findByText('inactive')).toBeDefined()
    })

    it('duplicate-click prevention: rapid double-clicking Deactivate only calls the API once', async () => {
      let resolveDeactivate: (value: unknown) => void = () => {}
      const deactivateAccount = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDeactivate = resolve
        })
      )
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [makeAccount()] }),
        deactivateAccount
      })
      render(<ChartOfAccountsScreen canManageAccounts={true} />)

      await screen.findByText('1000')
      const button = screen.getByRole('button', { name: 'Deactivate' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(deactivateAccount).toHaveBeenCalledTimes(1)
      resolveDeactivate({ success: true, account: makeAccount({ isActive: false }) })
    })
  })
})

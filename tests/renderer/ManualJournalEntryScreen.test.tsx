// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ManualJournalEntryScreen } from '../../src/renderer/src/accounting/ManualJournalEntryScreen'
import type { SafeAccount } from '../../src/shared/ipc/accounting'

afterEach(() => {
  cleanup()
})

function makeAccount(overrides: Partial<SafeAccount> = {}): SafeAccount {
  return {
    id: 'account_cash',
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

const cashAccount = makeAccount()
const revenueAccount = makeAccount({
  id: 'account_revenue',
  code: '4000',
  name: 'Sales Revenue',
  category: 'revenue',
  normalBalance: 'credit'
})
const inactiveAccount = makeAccount({
  id: 'account_inactive',
  code: '9999',
  name: 'Old Suspense',
  isActive: false
})

function installMockApi(
  overrides: {
    listAccounts?: ReturnType<typeof vi.fn>
    createJournalEntry?: ReturnType<typeof vi.fn>
  } = {}
) {
  const api = {
    listAccounts:
      overrides.listAccounts ??
      vi.fn().mockResolvedValue({ success: true, accounts: [cashAccount, revenueAccount] }),
    getAccount: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deactivateAccount: vi.fn(),
    reactivateAccount: vi.fn(),
    listJournalEntries: vi.fn(),
    getJournalEntry: vi.fn(),
    createJournalEntry:
      overrides.createJournalEntry ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reverseJournalEntry: vi.fn(),
    getTrialBalance: vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onCreated/onCancel in tests that don't assert them
}

async function fillValidTwoLineEntry(): Promise<void> {
  await screen.findAllByText('1000 \u2013 Cash on Hand')
  fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Cash sale' } })
  const accountSelects = screen.getAllByLabelText('Account')
  fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
  fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
  const debitInputs = screen.getAllByLabelText('Debit')
  const creditInputs = screen.getAllByLabelText('Credit')
  fireEvent.change(debitInputs[0], { target: { value: '10.29' } })
  fireEvent.change(creditInputs[1], { target: { value: '10.29' } })
}

describe('ManualJournalEntryScreen', () => {
  describe('initial state', () => {
    it('starts with exactly 2 lines', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      expect(screen.getAllByLabelText('Account')).toHaveLength(2)
    })

    it('Add line adds a new line', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
      expect(screen.getAllByLabelText('Account')).toHaveLength(3)
    })

    it('Remove line works when more than 2 lines exist', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.click(screen.getByRole('button', { name: 'Add line' }))
      expect(screen.getAllByLabelText('Account')).toHaveLength(3)

      fireEvent.click(screen.getByRole('button', { name: 'Remove line 3' }))
      expect(screen.getAllByLabelText('Account')).toHaveLength(2)
    })

    it('cannot go below 2 lines -- Remove is disabled at exactly 2 lines', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      const removeButtons = screen.getAllByRole('button', { name: /remove line/i })
      expect(removeButtons).toHaveLength(2)
      for (const button of removeButtons) {
        expect(button).toHaveProperty('disabled', true)
      }
    })
  })

  describe('account picker', () => {
    it('calls listAccounts exactly once', async () => {
      const listAccounts = vi
        .fn()
        .mockResolvedValue({ success: true, accounts: [cashAccount, revenueAccount] })
      installMockApi({ listAccounts })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      expect(listAccounts).toHaveBeenCalledTimes(1)
    })

    it('active accounts appear, inactive accounts are excluded', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({
          success: true,
          accounts: [cashAccount, revenueAccount, inactiveAccount]
        })
      })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      expect(screen.getAllByText('4000 \u2013 Sales Revenue').length).toBeGreaterThan(0)
      expect(screen.queryByText('9999 \u2013 Old Suspense')).toBeNull()
    })

    it('handles a listAccounts failure safely (no crash, empty picker)', async () => {
      installMockApi({
        listAccounts: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      expect(
        await screen.findByText('Couldn\u2019t load accounts. Try reloading the app.')
      ).toBeDefined()
    })
  })

  describe('decimal parsing (via debit/credit fields)', () => {
    it('0.29 is accepted and produces a balanced 29/29 total', async () => {
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_1' } })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '0.29' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '0.29' } })

      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))
      await waitFor(() => expect(createJournalEntry).toHaveBeenCalled())
      const payload = createJournalEntry.mock.calls[0][0]
      expect(payload.lines[0].debitMinor).toBe(29)
      expect(payload.lines[1].creditMinor).toBe(29)
    })

    it('10.29 -> 1029', async () => {
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_1' } })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))
      await waitFor(() => expect(createJournalEntry).toHaveBeenCalled())
      const payload = createJournalEntry.mock.calls[0][0]
      expect(payload.lines[0].debitMinor).toBe(1029)
      expect(payload.lines[1].creditMinor).toBe(1029)
    })

    it('rejects 1.005 -- submit stays disabled', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '1.005' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '1.005' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('rejects +1', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '+1' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '1' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('rejects negative amounts', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '-1' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '1' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('rejects exponent notation', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '1e2' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '100' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })
  })

  describe('line validity', () => {
    it('debit-only is valid, credit-only is valid, both-positive is invalid, both-zero is invalid', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })

      // Both zero (nothing entered) -- invalid, submit disabled.
      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )

      // Both positive on the same line -- invalid.
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '10' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[0], { target: { value: '10' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '10' } })
      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )

      // Fix to debit-only / credit-only -- valid.
      fireEvent.change(screen.getAllByLabelText('Credit')[0], { target: { value: '' } })
      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        false
      )
    })

    it('a malformed value invalidates the line', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: 'abc' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '10' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('a missing account invalidates the line', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      // Only fill the second line's account.
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '10' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '10' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })
  })

  describe('journal validity', () => {
    it('a blank description is invalid', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '10' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '10' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('unequal totals are invalid', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'X' } })
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })
      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '10' } })
      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '9' } })

      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
      expect(screen.getByText('Out of balance')).toBeDefined()
    })

    it('equal positive totals are valid', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        false
      )
      expect(screen.getByText('Balanced')).toBeDefined()
    })
  })

  describe('live totals', () => {
    it('debit and credit totals update as values change', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      const accountSelects = screen.getAllByLabelText('Account')
      fireEvent.change(accountSelects[0], { target: { value: cashAccount.id } })
      fireEvent.change(accountSelects[1], { target: { value: revenueAccount.id } })

      fireEvent.change(screen.getAllByLabelText('Debit')[0], { target: { value: '5.00' } })
      expect(screen.getByText('Total debit: 5.00')).toBeDefined()

      fireEvent.change(screen.getAllByLabelText('Credit')[1], { target: { value: '3.00' } })
      expect(screen.getByText('Total credit: 3.00')).toBeDefined()
    })
  })

  describe('payload shape', () => {
    it('sends exactly the approved top-level keys, and each line only the approved keys', async () => {
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_1' } })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))

      await waitFor(() => expect(createJournalEntry).toHaveBeenCalledTimes(1))
      const payload = createJournalEntry.mock.calls[0][0]

      expect(Object.keys(payload).sort()).toEqual(
        ['entryDate', 'description', 'externalReference', 'lines'].sort()
      )
      for (const line of payload.lines) {
        expect(Object.keys(line).sort()).toEqual(
          ['accountId', 'debitMinor', 'creditMinor', 'description'].sort()
        )
      }
    })

    it('never includes currencyId, entryNumber, createdByUserId, actor, actorId, companyId, reversedEntryId, createdAt, or any line id/lineOrder/companyId/journalEntryId', async () => {
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_1' } })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))

      await waitFor(() => expect(createJournalEntry).toHaveBeenCalledTimes(1))
      const payload = createJournalEntry.mock.calls[0][0]
      const serialized = JSON.stringify(payload)

      for (const forbidden of [
        'currencyId',
        'entryNumber',
        'createdByUserId',
        'actor',
        'actorId',
        'companyId',
        'reversedEntryId',
        'createdAt',
        'lineOrder',
        'journalEntryId'
      ]) {
        expect(serialized).not.toContain(forbidden)
      }
      for (const line of payload.lines) {
        expect(line.id).toBeUndefined()
      }
    })
  })

  describe('submission', () => {
    it('the submit button is disabled while the form is invalid', async () => {
      installMockApi()
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await screen.findAllByText('1000 \u2013 Cash on Hand')
      expect(screen.getByRole('button', { name: 'Post journal entry' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('rapid repeated submission makes exactly one IPC call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createJournalEntry = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      const button = screen.getByRole('button', { name: 'Post journal entry' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(createJournalEntry).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, entry: { id: 'journal_entry_1' } })
    })

    it('a safe error keeps the entered form values intact', async () => {
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unbalanced_entry' })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={noop} onCancel={noop} />)

      await fillValidTwoLineEntry()
      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))

      await screen.findByText('Total debits must equal total credits.')
      expect(screen.getByLabelText('Description')).toHaveProperty('value', 'Cash sale')
    })

    it('a successful create calls onCreated with the new entry id', async () => {
      const onCreated = vi.fn()
      const createJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_99' } })
      installMockApi({ createJournalEntry })
      render(<ManualJournalEntryScreen onCreated={onCreated} onCancel={noop} />)

      await fillValidTwoLineEntry()
      fireEvent.click(screen.getByRole('button', { name: 'Post journal entry' }))

      await waitFor(() => expect(onCreated).toHaveBeenCalledWith('journal_entry_99'))
    })
  })
})

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { JournalEntryDetailScreen } from '../../src/renderer/src/accounting/JournalEntryDetailScreen'
import type { SafeJournalEntry, SafeJournalEntryLine } from '../../src/shared/ipc/accounting'

afterEach(() => {
  cleanup()
})

function makeLine(overrides: Partial<SafeJournalEntryLine> = {}): SafeJournalEntryLine {
  return {
    id: 'journal_entry_line_1',
    accountId: 'account_1',
    accountCode: '1000',
    accountName: 'Cash on Hand',
    debitMinor: 1029,
    creditMinor: 0,
    description: null,
    lineOrder: 0,
    ...overrides
  }
}

function makeEntry(overrides: Partial<SafeJournalEntry> = {}): SafeJournalEntry {
  return {
    id: 'journal_entry_1',
    entryNumber: 'JE-2026-000001',
    entryDate: Date.now(),
    description: 'Cash sale',
    externalReference: null,
    currencyId: 'currency_usd',
    createdByUserId: 'user_1',
    createdByLabel: 'Ben',
    reversedEntryId: null,
    reversalReason: null,
    hasBeenReversed: false,
    createdAt: Date.now(),
    lines: [
      makeLine({ id: 'l1', accountCode: '1000', accountName: 'Cash on Hand', lineOrder: 0 }),
      makeLine({
        id: 'l2',
        accountCode: '4000',
        accountName: 'Sales Revenue',
        debitMinor: 0,
        creditMinor: 1029,
        lineOrder: 1
      })
    ],
    ...overrides
  }
}

function installMockApi(
  overrides: {
    getJournalEntry?: ReturnType<typeof vi.fn>
    reverseJournalEntry?: ReturnType<typeof vi.fn>
  } = {}
) {
  const api = {
    listAccounts: vi.fn(),
    getAccount: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deactivateAccount: vi.fn(),
    reactivateAccount: vi.fn(),
    listJournalEntries: vi.fn(),
    getJournalEntry:
      overrides.getJournalEntry ?? vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
    createJournalEntry: vi.fn(),
    reverseJournalEntry:
      overrides.reverseJournalEntry ??
      vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    getTrialBalance: vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onReversed/onBack in tests that don't assert them
}

describe('JournalEntryDetailScreen', () => {
  it('shows a loading state, then the rendered header', async () => {
    installMockApi()
    render(
      <JournalEntryDetailScreen
        journalEntryId="journal_entry_1"
        canManageJournalEntries={false}
        onReversed={noop}
        onBack={noop}
      />
    )

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('JE-2026-000001')).toBeDefined()
  })

  it('shows a safe error message on failure', async () => {
    installMockApi({
      getJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' })
    })
    render(
      <JournalEntryDetailScreen
        journalEntryId="journal_entry_1"
        canManageJournalEntries={false}
        onReversed={noop}
        onBack={noop}
      />
    )

    expect(
      await screen.findByText('Couldn\u2019t load this journal entry. Try reloading the app.')
    ).toBeDefined()
  })

  describe('header', () => {
    it('shows entry number, date, description, reference, createdByLabel, and USD-only currency presentation', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({ description: 'Cash sale', externalReference: 'INV-100' })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.getByText('Cash sale')).toBeDefined()
      expect(screen.getByText('Reference: INV-100')).toBeDefined()
      expect(screen.getByText('Created by: Ben')).toBeDefined()
      expect(screen.getByText('Currency: USD')).toBeDefined()
      expect(screen.queryByText(/currency_usd/)).toBeNull()
    })

    it('shows the reversal relationship and reason when this entry is itself a reversal', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({
            reversedEntryId: 'journal_entry_original',
            reversalReason: 'Undo mistaken entry'
          })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.getByText('This entry is a reversal of journal_entry_original')).toBeDefined()
      expect(screen.getByText('Reversal reason: Undo mistaken entry')).toBeDefined()
    })

    it('an existing journal remains visible if a subsequent reversal request fails', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
        reverseJournalEntry: vi
          .fn()
          .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Undo' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))

      await screen.findByText('Something went wrong. Please try again.')
      expect(screen.getByText('JE-2026-000001')).toBeDefined()
    })
  })

  describe('lines', () => {
    it('preserves server line ordering exactly', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({
            lines: [
              makeLine({ id: 'l1', accountCode: '4000', accountName: 'Revenue', lineOrder: 0 }),
              makeLine({ id: 'l2', accountCode: '1000', accountName: 'Cash', lineOrder: 1 })
            ]
          })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      const rows = screen.getAllByRole('row')
      // rows[0] is the header row.
      expect(rows[1].textContent).toContain('4000')
      expect(rows[2].textContent).toContain('1000')
    })

    it('shows line number, account code/name, description, debit and credit', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({
            lines: [
              makeLine({
                id: 'l1',
                accountCode: '1000',
                accountName: 'Cash on Hand',
                description: 'Deposit',
                debitMinor: 1029,
                creditMinor: 0
              }),
              makeLine({
                id: 'l2',
                accountCode: '4000',
                accountName: 'Sales Revenue',
                debitMinor: 0,
                creditMinor: 1029
              })
            ]
          })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.getByText('1000 \u2013 Cash on Hand')).toBeDefined()
      expect(screen.getByText('4000 \u2013 Sales Revenue')).toBeDefined()
      expect(screen.getByText('Deposit')).toBeDefined()
      expect(screen.getAllByText('USD 10.29').length).toBeGreaterThan(0)
    })

    it('shows totals and a Balanced indicator when debits equal credits', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.getByText(/Balanced/)).toBeDefined()
    })

    it('shows an Out of balance indicator if the read data is malformed/unbalanced', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({
            lines: [
              makeLine({ id: 'l1', debitMinor: 1000, creditMinor: 0 }),
              makeLine({ id: 'l2', debitMinor: 0, creditMinor: 900 })
            ]
          })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.getByText(/Out of balance/)).toBeDefined()
    })
  })

  describe('immutability', () => {
    it('no Edit Journal, Delete Journal, Remove Journal, line-edit, or line-delete control exists anywhere', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    })

    it('no currency selector or editable accounting-authority field exists anywhere', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.queryByRole('combobox')).toBeNull()
      // Only the reversal-reason field, if shown, may exist as a textbox.
      expect(screen.queryAllByRole('textbox').length).toBeLessThanOrEqual(1)
    })
  })

  describe('reversal controls', () => {
    it('hidden when canManageJournalEntries=false', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={false}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.queryByRole('button', { name: 'Reverse entry' })).toBeNull()
    })

    it('visible for an eligible original entry when canManageJournalEntries=true', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      expect(await screen.findByRole('button', { name: 'Reverse entry' })).toBeDefined()
    })

    it('hidden when reversedEntryId !== null (this entry is itself a reversal)', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({
          success: true,
          entry: makeEntry({ reversedEntryId: 'journal_entry_original', reversalReason: 'X' })
        })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.queryByRole('button', { name: 'Reverse entry' })).toBeNull()
    })

    it('hidden when hasBeenReversed=true', async () => {
      installMockApi({
        getJournalEntry: vi
          .fn()
          .mockResolvedValue({ success: true, entry: makeEntry({ hasBeenReversed: true }) })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      expect(screen.queryByRole('button', { name: 'Reverse entry' })).toBeNull()
    })

    it('a blank/whitespace-only reason cannot submit', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: '   ' } })

      expect(screen.getByRole('button', { name: 'Confirm reversal' })).toHaveProperty(
        'disabled',
        true
      )
    })

    it('a trimmed reason is forwarded exactly, and the payload contains only journalEntryId and reversalReason', async () => {
      const reverseJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_reversal' } })
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
        reverseJournalEntry
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), {
        target: { value: '  Undo mistaken entry  ' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))

      await waitFor(() => expect(reverseJournalEntry).toHaveBeenCalledTimes(1))
      const payload = reverseJournalEntry.mock.calls[0][0]
      expect(Object.keys(payload).sort()).toEqual(['journalEntryId', 'reversalReason'].sort())
      expect(payload.journalEntryId).toBe('journal_entry_1')
      expect(payload.reversalReason).toBe('  Undo mistaken entry  ')
    })

    it('rapid repeated clicks result in exactly one reverseJournalEntry call', async () => {
      let resolveReverse: (value: unknown) => void = () => {}
      const reverseJournalEntry = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveReverse = resolve
        })
      )
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
        reverseJournalEntry
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Undo' } })
      const confirmButton = screen.getByRole('button', { name: 'Confirm reversal' })
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)
      fireEvent.click(confirmButton)

      expect(reverseJournalEntry).toHaveBeenCalledTimes(1)
      resolveReverse({ success: true, entry: { id: 'journal_entry_reversal' } })
    })

    it('a failed reversal preserves the journal and the entered reason', async () => {
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
        reverseJournalEntry: vi
          .fn()
          .mockResolvedValue({ success: false, errorCode: 'already_reversed' })
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={noop}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Undo' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))

      await screen.findByText('This entry has already been reversed.')
      expect(screen.getByLabelText('Reversal reason')).toHaveProperty('value', 'Undo')
      expect(screen.getByText('JE-2026-000001')).toBeDefined()
    })

    it('a successful reversal calls onReversed with the new entry id', async () => {
      const onReversed = vi.fn()
      const reverseJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: { id: 'journal_entry_reversal_99' } })
      installMockApi({
        getJournalEntry: vi.fn().mockResolvedValue({ success: true, entry: makeEntry() }),
        reverseJournalEntry
      })
      render(
        <JournalEntryDetailScreen
          journalEntryId="journal_entry_1"
          canManageJournalEntries={true}
          onReversed={onReversed}
          onBack={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.click(screen.getByRole('button', { name: 'Reverse entry' }))
      fireEvent.change(screen.getByLabelText('Reversal reason'), { target: { value: 'Undo' } })
      fireEvent.click(screen.getByRole('button', { name: 'Confirm reversal' }))

      await waitFor(() => expect(onReversed).toHaveBeenCalledWith('journal_entry_reversal_99'))
    })
  })
})

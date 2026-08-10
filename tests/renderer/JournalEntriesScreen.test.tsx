// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JournalEntriesScreen } from '../../src/renderer/src/accounting/JournalEntriesScreen'
import type { SafeJournalEntry } from '../../src/shared/ipc/accounting'

afterEach(() => {
  cleanup()
})

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
    lines: [],
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listJournalEntries?: ReturnType<typeof vi.fn>
  } = {}
) {
  const api = {
    listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
    getAccount: vi.fn(),
    createAccount: vi.fn(),
    updateAccount: vi.fn(),
    deactivateAccount: vi.fn(),
    reactivateAccount: vi.fn(),
    listJournalEntries:
      overrides.listJournalEntries ?? vi.fn().mockResolvedValue({ success: true, entries: [] }),
    getJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createJournalEntry: vi.fn(),
    reverseJournalEntry: vi.fn(),
    getTrialBalance: vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onOpenJournalEntry/onCreateJournalEntry in tests that don't assert them
}

describe('JournalEntriesScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [makeEntry()] })
    })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('JE-2026-000001')).toBeDefined()
  })

  it('shows an empty state', async () => {
    installMockApi({
      listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] })
    })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    expect(await screen.findByText('No journal entries yet.')).toBeDefined()
  })

  it('shows a safe error message on failure', async () => {
    installMockApi({
      listJournalEntries: vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    expect(
      await screen.findByText('Couldn\u2019t load journal entries. Try reloading the app.')
    ).toBeDefined()
  })

  it('preserves server ordering exactly -- never re-sorts client-side', async () => {
    const entries = [
      makeEntry({ id: 'je_3', entryNumber: 'JE-2026-000003' }),
      makeEntry({ id: 'je_1', entryNumber: 'JE-2026-000001' }),
      makeEntry({ id: 'je_2', entryNumber: 'JE-2026-000002' })
    ]
    installMockApi({ listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries }) })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    await screen.findByText('JE-2026-000003')
    const rows = screen.getAllByRole('row')
    // rows[0] is the header row.
    expect(rows[1].textContent).toContain('JE-2026-000003')
    expect(rows[2].textContent).toContain('JE-2026-000001')
    expect(rows[3].textContent).toContain('JE-2026-000002')
  })

  describe('search', () => {
    const cashSale = makeEntry({
      id: 'je_1',
      entryNumber: 'JE-2026-000001',
      description: 'Cash sale',
      externalReference: 'INV-100',
      createdByLabel: 'Ben'
    })
    const rentPayment = makeEntry({
      id: 'je_2',
      entryNumber: 'JE-2026-000002',
      description: 'Rent payment',
      externalReference: 'PO-200',
      createdByLabel: 'Amara'
    })

    it('searches by entryNumber', async () => {
      installMockApi({
        listJournalEntries: vi
          .fn()
          .mockResolvedValue({ success: true, entries: [cashSale, rentPayment] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={false}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.change(screen.getByLabelText('Search journal entries'), {
        target: { value: '000002' }
      })
      expect(screen.queryByText('Cash sale')).toBeNull()
      expect(screen.getByText('Rent payment')).toBeDefined()
    })

    it('searches by description', async () => {
      installMockApi({
        listJournalEntries: vi
          .fn()
          .mockResolvedValue({ success: true, entries: [cashSale, rentPayment] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={false}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.change(screen.getByLabelText('Search journal entries'), {
        target: { value: 'rent' }
      })
      expect(screen.queryByText('Cash sale')).toBeNull()
      expect(screen.getByText('Rent payment')).toBeDefined()
    })

    it('searches by externalReference', async () => {
      installMockApi({
        listJournalEntries: vi
          .fn()
          .mockResolvedValue({ success: true, entries: [cashSale, rentPayment] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={false}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.change(screen.getByLabelText('Search journal entries'), {
        target: { value: 'PO-200' }
      })
      expect(screen.queryByText('Cash sale')).toBeNull()
      expect(screen.getByText('Rent payment')).toBeDefined()
    })

    it('searches by createdByLabel', async () => {
      installMockApi({
        listJournalEntries: vi
          .fn()
          .mockResolvedValue({ success: true, entries: [cashSale, rentPayment] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={false}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      await screen.findByText('JE-2026-000001')
      fireEvent.change(screen.getByLabelText('Search journal entries'), {
        target: { value: 'amara' }
      })
      expect(screen.queryByText('Cash sale')).toBeNull()
      expect(screen.getByText('Rent payment')).toBeDefined()
    })
  })

  it('clicking a row opens the exact journal ID via onOpenJournalEntry', async () => {
    const onOpenJournalEntry = vi.fn()
    installMockApi({
      listJournalEntries: vi
        .fn()
        .mockResolvedValue({ success: true, entries: [makeEntry({ id: 'journal_entry_42' })] })
    })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={onOpenJournalEntry}
        onCreateJournalEntry={noop}
      />
    )

    fireEvent.click(await screen.findByText('JE-2026-000001'))
    expect(onOpenJournalEntry).toHaveBeenCalledWith('journal_entry_42')
  })

  describe('role-gated New Manual Journal button', () => {
    it('visible when canManageJournalEntries=true', async () => {
      installMockApi({
        listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={true}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      expect(await screen.findByRole('button', { name: 'New Manual Journal' })).toBeDefined()
    })

    it('absent when canManageJournalEntries=false', async () => {
      installMockApi({
        listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={false}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={noop}
        />
      )

      await screen.findByText('No journal entries yet.')
      expect(screen.queryByRole('button', { name: 'New Manual Journal' })).toBeNull()
    })

    it('clicking New Manual Journal calls onCreateJournalEntry', async () => {
      const onCreateJournalEntry = vi.fn()
      installMockApi({
        listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] })
      })
      render(
        <JournalEntriesScreen
          canManageJournalEntries={true}
          onOpenJournalEntry={noop}
          onCreateJournalEntry={onCreateJournalEntry}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'New Manual Journal' }))
      expect(onCreateJournalEntry).toHaveBeenCalledTimes(1)
    })
  })

  it('no Edit or Delete/Remove journal control exists anywhere, regardless of role', async () => {
    installMockApi({
      listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [makeEntry()] })
    })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={true}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    await screen.findByText('JE-2026-000001')
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
  })

  it('reversal and ordinary entries display clearly and distinctly', async () => {
    const entries = [
      makeEntry({ id: 'je_1', entryNumber: 'JE-2026-000001', reversedEntryId: null }),
      makeEntry({ id: 'je_2', entryNumber: 'JE-2026-000002', reversedEntryId: 'je_1' })
    ]
    installMockApi({ listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries }) })
    render(
      <JournalEntriesScreen
        canManageJournalEntries={false}
        onOpenJournalEntry={noop}
        onCreateJournalEntry={noop}
      />
    )

    await screen.findByText('JE-2026-000001')
    expect(screen.getByText('posted')).toBeDefined()
    expect(screen.getByText('reversal')).toBeDefined()
  })
})

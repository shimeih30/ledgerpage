// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { TrialBalanceScreen } from '../../src/renderer/src/accounting/TrialBalanceScreen'
import type { SafeTrialBalance, SafeTrialBalanceRow } from '../../src/shared/ipc/accounting'

afterEach(() => {
  cleanup()
})

function makeRow(overrides: Partial<SafeTrialBalanceRow> = {}): SafeTrialBalanceRow {
  return {
    id: 'account_1',
    code: '1000',
    name: 'Cash on Hand',
    category: 'asset',
    subtype: 'cash',
    normalBalance: 'debit',
    isActive: true,
    totalDebitMinor: 0,
    totalCreditMinor: 0,
    closingDebitMinor: 0,
    closingCreditMinor: 0,
    ...overrides
  }
}

function makeTrialBalance(overrides: Partial<SafeTrialBalance> = {}): SafeTrialBalance {
  return {
    accounts: [makeRow()],
    grandTotalDebitMinor: 0,
    grandTotalCreditMinor: 0,
    isBalanced: true,
    ...overrides
  }
}

function installMockApi(
  overrides: {
    getTrialBalance?: ReturnType<typeof vi.fn>
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
    getJournalEntry: vi.fn(),
    createJournalEntry: vi.fn(),
    reverseJournalEntry: vi.fn(),
    getTrialBalance:
      overrides.getTrialBalance ??
      vi.fn().mockResolvedValue({ success: true, trialBalance: makeTrialBalance() })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

describe('TrialBalanceScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      getTrialBalance: vi
        .fn()
        .mockResolvedValue({ success: true, trialBalance: makeTrialBalance() })
    })
    render(<TrialBalanceScreen />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('1000')).toBeDefined()
  })

  it('shows a safe error message on failure', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<TrialBalanceScreen />)

    expect(
      await screen.findByText('Couldn\u2019t load the trial balance. Try reloading the app.')
    ).toBeDefined()
  })

  it('shows an empty accounts table when the trial balance has no accounts', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({ accounts: [] })
      })
    })
    render(<TrialBalanceScreen />)

    expect(await screen.findByText('Grand total')).toBeDefined()
    expect(screen.queryByText('1000')).toBeNull()
  })

  it('preserves server row ordering exactly', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({
          accounts: [
            makeRow({ id: 'a3', code: '3000', name: "Owner's Equity" }),
            makeRow({ id: 'a1', code: '1000', name: 'Cash on Hand' }),
            makeRow({ id: 'a2', code: '2000', name: 'Accounts Payable' })
          ]
        })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('3000')
    const rows = screen.getAllByRole('row')
    // rows[0] is the header row.
    expect(rows[1].textContent).toContain('3000')
    expect(rows[2].textContent).toContain('1000')
    expect(rows[3].textContent).toContain('2000')
  })

  it('includes inactive accounts', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({ accounts: [makeRow({ isActive: false })] })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.getByText('inactive')).toBeDefined()
  })

  it('includes zero-balance accounts', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({
          accounts: [
            makeRow({
              totalDebitMinor: 0,
              totalCreditMinor: 0,
              closingDebitMinor: 0,
              closingCreditMinor: 0
            })
          ]
        })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.getAllByText('0.00').length).toBeGreaterThan(0)
  })

  it('shows every specified column', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({
          accounts: [
            makeRow({
              totalDebitMinor: 5000,
              totalCreditMinor: 0,
              closingDebitMinor: 5000,
              closingCreditMinor: 0
            })
          ]
        })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.getByText('Cash on Hand')).toBeDefined()
    expect(screen.getByText('asset')).toBeDefined()
    expect(screen.getByText('debit')).toBeDefined()
    expect(screen.getAllByText('50.00').length).toBeGreaterThan(0)
    expect(screen.getByText('active')).toBeDefined()
  })

  it('shows total debit/credit and closing debit/credit correctly', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({
          accounts: [
            makeRow({
              totalDebitMinor: 5000,
              totalCreditMinor: 2000,
              closingDebitMinor: 3000,
              closingCreditMinor: 0
            })
          ]
        })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.getByText('50.00')).toBeDefined()
    expect(screen.getByText('20.00')).toBeDefined()
    expect(screen.getByText('30.00')).toBeDefined()
  })

  it('shows the grand total row with correct debit/credit totals', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({
          accounts: [makeRow()],
          grandTotalDebitMinor: 123456,
          grandTotalCreditMinor: 123456
        })
      })
    })
    render(<TrialBalanceScreen />)

    await screen.findByText('Grand total')
    expect(screen.getAllByText('1234.56').length).toBeGreaterThan(0)
  })

  it('shows Balanced when isBalanced is true', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({ isBalanced: true })
      })
    })
    render(<TrialBalanceScreen />)

    expect(await screen.findByText('Balanced')).toBeDefined()
  })

  it('shows Out of balance when isBalanced is false', async () => {
    installMockApi({
      getTrialBalance: vi.fn().mockResolvedValue({
        success: true,
        trialBalance: makeTrialBalance({ isBalanced: false })
      })
    })
    render(<TrialBalanceScreen />)

    expect(await screen.findByText('Out of balance')).toBeDefined()
  })

  it('has no date picker or period selector', async () => {
    installMockApi()
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.queryByLabelText(/date/i)).toBeNull()
    expect(screen.queryByLabelText(/period/i)).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('has no mutation control and no account/journal edit control', async () => {
    installMockApi()
    render(<TrialBalanceScreen />)

    await screen.findByText('1000')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

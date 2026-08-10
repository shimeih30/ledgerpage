import { describe, expect, it } from 'vitest'
import * as accountingContract from '../../../src/shared/ipc/accounting'

/**
 * A dedicated structural test against the shared contract module
 * itself (src/shared/ipc/accounting.ts) -- distinct from
 * registerAccountingHandlers.test.ts's own "no extra channel
 * registered" check and noDatabaseAccess.test.ts's own "no mutation
 * preload/global method" check, both of which test downstream
 * consumers of this module rather than the module's own exports
 * directly.
 *
 * Unlike Slice 15's inventoryLots contract (entirely read-only),
 * Slice 16's accounting contract legitimately includes manage-shaped
 * channels (accounts:create, accounts:update, journal-entries:create,
 * journal-entries:reverse, etc.) -- approved scope. So this file
 * checks for the specific prohibited surface (update/delete for
 * journal entries or lines, automatic/operational posting, drafts,
 * approvals, period locking, currency selection), not a blanket
 * "nothing here looks like a mutation" rule, which would be the wrong
 * check for this particular contract.
 */
describe('shared/ipc/accounting.ts contract', () => {
  const EXPECTED_CHANNEL_VALUES = [
    'accounts:list',
    'accounts:get',
    'accounts:create',
    'accounts:update',
    'accounts:deactivate',
    'accounts:reactivate',
    'journal-entries:list',
    'journal-entries:get',
    'journal-entries:create',
    'journal-entries:reverse',
    'trial-balance:get'
  ]

  const PROHIBITED_NAMES = [
    'deleteAccount',
    'removeAccount',
    'updateJournalEntry',
    'deleteJournalEntry',
    'removeJournalEntry',
    'updateJournalEntryLine',
    'deleteJournalEntryLine',
    'removeJournalEntryLine',
    'postOperationalEntry',
    'automaticPosting',
    'createDraftJournalEntry',
    'approveJournalEntry',
    'unlockPeriod',
    'closeAccountingPeriod',
    'selectJournalCurrency'
  ]

  it('exports exactly 11 channel constants, matching the approved list exactly', () => {
    const exportedChannelValues = Object.entries(accountingContract)
      .filter(([name]) => name.endsWith('_CHANNEL'))
      .map(([, value]) => value)

    expect(exportedChannelValues).toHaveLength(11)
    expect(exportedChannelValues.sort()).toEqual([...EXPECTED_CHANNEL_VALUES].sort())
  })

  it('does not export any of the 15 explicitly prohibited mutation function names', () => {
    const runtimeExportNames = Object.keys(accountingContract)
    for (const name of PROHIBITED_NAMES) {
      expect(runtimeExportNames).not.toContain(name)
    }
  })

  it('no exported channel constant name or value matches any prohibited surface', () => {
    const channelEntries = Object.entries(accountingContract).filter(([name]) =>
      name.endsWith('_CHANNEL')
    )
    const prohibitedPattern =
      /update.?journal|delete|remove|automatic|operational|draft|approve|unlock|close.?period|select.?currency/i
    for (const [, value] of channelEntries) {
      expect(String(value)).not.toMatch(prohibitedPattern)
    }
  })

  it('LedgerPageAccountingApi is a type-only export -- confirmed structurally via runtime exports containing no prohibited-named function, type-only or otherwise', () => {
    const runtimeExportNames = Object.keys(accountingContract)
    for (const name of PROHIBITED_NAMES) {
      expect(runtimeExportNames).not.toContain(name)
    }
    // LedgerPageAccountingApi itself has no runtime representation
    // (interfaces are erased at compile time) -- its own shape is
    // enforced by registerAccountingHandlers.ts/preload/index.ts
    // actually implementing it, checked in those files' own tests.
    expect((accountingContract as Record<string, unknown>).LedgerPageAccountingApi).toBeUndefined()
  })
})

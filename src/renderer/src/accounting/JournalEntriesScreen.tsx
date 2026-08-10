import { useEffect, useMemo, useState } from 'react'
import {
  auditBannerStyle,
  auditBodyCellStyle,
  auditColors,
  auditFieldStyle,
  auditFilterBarStyle,
  auditHeaderCellStyle,
  auditHeaderRowStyle,
  auditHeadingStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle,
  auditTableStyle
} from '../shared/ui'
import type { SafeJournalEntry } from '../../../shared/ipc/accounting'

interface JournalEntriesScreenProps {
  canManageJournalEntries: boolean
  onOpenJournalEntry: (journalEntryId: string) => void
  onCreateJournalEntry: () => void
}

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; entries: SafeJournalEntry[] }

function fetchJournalEntries(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listJournalEntries()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', entries: result.entries })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Client-side, case-insensitive search over entry number, description,
 * external reference, and the resolved createdByLabel — mirroring
 * every other list screen's own established search pattern.
 */
function matchesSearch(entry: SafeJournalEntry, query: string): boolean {
  if (query === '') {
    return true
  }
  const needle = query.toLowerCase()
  return (
    entry.entryNumber.toLowerCase().includes(needle) ||
    entry.description.toLowerCase().includes(needle) ||
    (entry.externalReference ?? '').toLowerCase().includes(needle) ||
    (entry.createdByLabel ?? '').toLowerCase().includes(needle)
  )
}

function formatDate(timestampMs: number): string {
  return new Intl.DateTimeFormat('en-ZW', { dateStyle: 'medium' }).format(new Date(timestampMs))
}

function reversalStatusBadgeStyle(kind: 'reversal' | 'normal') {
  const colorsByKind: Record<typeof kind, { backgroundColor: string; color: string }> = {
    reversal: { backgroundColor: '#FAEEDA', color: '#633806' },
    normal: { backgroundColor: '#EAF3DE', color: '#27500A' }
  }
  return {
    display: 'inline-block' as const,
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    ...colorsByKind[kind]
  }
}

/**
 * Reversal status is presented purely from fields already on
 * SafeJournalEntry: reversedEntryId !== null means this entry IS a
 * reversal of something else ("reversal"); everything else displays as
 * a plain posted entry ("normal") — this screen does not attempt to
 * show whether an entry HAS BEEN reversed, since SafeJournalEntry does
 * not expose that (see JournalEntryDetailScreen's own comment on this
 * same limitation).
 */
function reversalStatusLabel(entry: SafeJournalEntry): 'reversal' | 'normal' {
  return entry.reversedEntryId !== null ? 'reversal' : 'normal'
}

/**
 * Trusts server ordering entirely — listJournalEntries's own IPC
 * contract returns entries newest-first already; this screen never
 * re-sorts client-side.
 */
export function JournalEntriesScreen({
  canManageJournalEntries,
  onOpenJournalEntry,
  onCreateJournalEntry
}: JournalEntriesScreenProps) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    fetchJournalEntries(setState)
  }, [])

  const entries = useMemo(() => (state.kind === 'ready' ? state.entries : []), [state])

  const filteredEntries = useMemo(
    () => entries.filter((entry) => matchesSearch(entry, searchQuery)),
    [entries, searchQuery]
  )

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Journal Entries</h1>
        {canManageJournalEntries && (
          <button type="button" onClick={onCreateJournalEntry} style={auditPrimaryButtonStyle}>
            New Manual Journal
          </button>
        )}
      </div>

      {state.kind === 'ready' && entries.length > 0 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label htmlFor="journal-search" style={{ display: 'none' }}>
            Search journal entries
          </label>
          <input
            id="journal-search"
            type="text"
            placeholder="Search by entry number, description, reference, or creator…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            style={{ ...auditFieldStyle(), maxWidth: '28rem' }}
          />
        </div>
      )}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load journal entries. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && entries.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No journal entries yet.
        </p>
      )}

      {state.kind === 'ready' && entries.length > 0 && filteredEntries.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No journal entries match &ldquo;{searchQuery}&rdquo;.
        </p>
      )}

      {state.kind === 'ready' && filteredEntries.length > 0 && (
        <div style={auditPanelStyle}>
          <table style={auditTableStyle}>
            <thead>
              <tr style={auditHeaderRowStyle}>
                <th style={auditHeaderCellStyle}>Entry number</th>
                <th style={auditHeaderCellStyle}>Date</th>
                <th style={auditHeaderCellStyle}>Description</th>
                <th style={auditHeaderCellStyle}>Reference</th>
                <th style={auditHeaderCellStyle}>Created by</th>
                <th style={auditHeaderCellStyle}>Reversal status</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry, index) => (
                <tr
                  key={entry.id}
                  onClick={() => onOpenJournalEntry(entry.id)}
                  style={{
                    cursor: 'pointer',
                    borderBottom:
                      index === filteredEntries.length - 1
                        ? 'none'
                        : `1px solid ${auditColors.border}`
                  }}
                >
                  <td style={{ ...auditBodyCellStyle, fontFamily: 'ui-monospace, monospace' }}>
                    {entry.entryNumber}
                  </td>
                  <td style={auditBodyCellStyle}>{formatDate(entry.entryDate)}</td>
                  <td style={auditBodyCellStyle}>{entry.description}</td>
                  <td style={auditBodyCellStyle}>{entry.externalReference ?? '\u2014'}</td>
                  <td style={auditBodyCellStyle}>{entry.createdByLabel ?? '\u2014'}</td>
                  <td style={auditBodyCellStyle}>
                    {reversalStatusLabel(entry) === 'reversal' ? (
                      <span style={reversalStatusBadgeStyle('reversal')}>reversal</span>
                    ) : (
                      <span style={reversalStatusBadgeStyle('normal')}>posted</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

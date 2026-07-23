import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  auditActionBadgeStyle,
  auditBannerStyle,
  auditBodyCellStyle,
  auditFieldErrorTextStyle,
  auditFieldGroupStyle,
  auditFieldStyle,
  auditFilterBarStyle,
  auditFilterControlsStyle,
  auditGhostButtonStyle,
  auditHeaderCellStyle,
  auditHeaderRowStyle,
  auditHeadingStyle,
  auditLabelStyle,
  auditPageStyle,
  auditPanelStyle,
  auditPrimaryButtonStyle,
  auditRedactedPillStyle,
  auditTableStyle,
  auditColors
} from '../shared/ui'
import type {
  AuditCursor,
  ListAuditEntriesInput,
  SafeAuditLogEntry
} from '../../../shared/ipc/audit'
import { validateDateFilters } from './dateFilters'

/**
 * A fixed, hardcoded list — there is no "list distinct entity types"
 * endpoint, and this slice's own retrofits are the only source of
 * entries today. Matches CreateUserForm's own "fixed, known set, never
 * free text" posture for a filter dropdown.
 */
const KNOWN_ENTITY_TYPES = [
  'company',
  'numbering_rule',
  'tax_code',
  'tax_rate_version',
  'user',
  'user_role',
  'owner_recovery_credential'
] as const

const REDACTED_PLACEHOLDER_VALUE = '[redacted]'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'unauthorized' }
  | { kind: 'error' }
  | { kind: 'ready'; entries: SafeAuditLogEntry[]; nextCursor?: AuditCursor }

function isAuthErrorCode(errorCode: string): boolean {
  return errorCode === 'not_authorized' || errorCode === 'session_invalid'
}

function buildFilterInput(
  entityType: string,
  fromOccurredAt: number | undefined,
  toOccurredAt: number | undefined
): ListAuditEntriesInput {
  const input: ListAuditEntriesInput = {}
  if (entityType) {
    input.entityType = entityType
  }
  if (fromOccurredAt !== undefined) {
    input.fromOccurredAt = fromOccurredAt
  }
  if (toOccurredAt !== undefined) {
    input.toOccurredAt = toOccurredAt
  }
  return input
}

function fetchEntries(
  filterInput: ListAuditEntriesInput,
  setState: (next: LoadState) => void
): void {
  window.ledgerpage
    .listAuditEntries(filterInput)
    .then((result) => {
      if (!result.success) {
        setState(isAuthErrorCode(result.errorCode) ? { kind: 'unauthorized' } : { kind: 'error' })
        return
      }
      setState({ kind: 'ready', entries: result.entries, nextCursor: result.nextCursor })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Renders a changed-field value as inline content. The redacted
 * placeholder gets a small, visually distinct pill (auditRedactedPillStyle)
 * so a redacted value reads as a deliberate, recognizable marker rather
 * than plain text easy to miss while scanning. Everything else renders
 * as plain text content — React escapes it by default; this function
 * (and this whole file) never uses dangerouslySetInnerHTML, so a
 * malicious string in a changed-field value is never parsed as markup,
 * only ever displayed as literal characters.
 */
function renderFieldValue(value: unknown): ReactNode {
  if (value === REDACTED_PLACEHOLDER_VALUE) {
    return <span style={auditRedactedPillStyle}>[REDACTED]</span>
  }
  if (value === null || value === undefined) {
    return '\u2014'
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatTimestamp(occurredAt: number): string {
  return new Date(occurredAt).toLocaleString()
}

function summarizeChangedFieldCount(fieldCount: number): string {
  return fieldCount === 1 ? '1 field changed' : `${String(fieldCount)} fields changed`
}

/**
 * Reachable in this renderer only from AuthenticatedShell's link, shown
 * when session.canViewAuditLog is true — but that flag is cosmetic
 * only, per Slice 10's own design (see loginService.ts and
 * registerAuditHandlers.ts). Every call this screen makes goes through
 * audit:list, which independently re-authorizes fresh from live SQLite
 * role data on every single call — a caller reaching this screen
 * through any other path (a stale build, a direct IPC call, a locked
 * or deactivated session) still gets the same uniform, safe failure
 * audit:list itself would return, never partial or unredacted data.
 *
 * Visual language lives in ./ui.ts, deliberately separate from
 * setup/ui.ts (Slice 8/9's shared token set) — this screen's palette
 * and density are intentionally different and this keeps that
 * difference from ever leaking into an unrelated screen.
 */
export function AuditLogScreen() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [entityTypeFilter, setEntityTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [fromError, setFromError] = useState<string | undefined>(undefined)
  const [toError, setToError] = useState<string | undefined>(undefined)
  const [rangeError, setRangeError] = useState<string | undefined>(undefined)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadMoreError, setLoadMoreError] = useState<string | undefined>(undefined)

  // The filter set actually behind the entries currently on screen —
  // distinct from entityTypeFilter/fromDate/toDate, which track the
  // live, possibly-since-edited form values. Only ever updated once
  // validation passes and a request is actually dispatched, so Load
  // More (which reads this, never the live form state) always extends
  // the same query the visible rows came from, never a filter set the
  // user typed but never successfully applied.
  const [appliedFilterInput, setAppliedFilterInput] = useState<ListAuditEntriesInput>({})

  // Mirrors UsersAndRolesScreen's own established pattern: the mount
  // effect calls fetchEntries directly, with no synchronous setState of
  // its own — `reload` (used only from event handlers below) is the one
  // that does the synchronous setState-then-fetch.
  //
  // Validates the two date fields before ever building a request: an
  // individually invalid date sets that field's own inline error and
  // returns without calling listAuditEntries at all (never silently
  // omitting the bad filter, which could otherwise broaden the query
  // far past what the user intended); a From-after-To combination sets
  // a range error under the same rule. The user's typed fromDate/toDate
  // values are never touched here, so they remain exactly as entered
  // for correcting. A successful validation clears every prior
  // validation error before dispatching.
  const reload = useCallback(() => {
    const validation = validateDateFilters(fromDate, toDate)
    if (!validation.ok) {
      setFromError(validation.fromError)
      setToError(validation.toError)
      setRangeError(validation.rangeError)
      return
    }

    setFromError(undefined)
    setToError(undefined)
    setRangeError(undefined)

    const filterInput = buildFilterInput(
      entityTypeFilter,
      validation.fromOccurredAt,
      validation.toOccurredAt
    )
    setAppliedFilterInput(filterInput)
    setState({ kind: 'loading' })
    setLoadMoreError(undefined)
    fetchEntries(filterInput, setState)
  }, [entityTypeFilter, fromDate, toDate])

  useEffect(() => {
    fetchEntries({}, setState)
  }, [])

  async function handleLoadMore(): Promise<void> {
    if (state.kind !== 'ready' || !state.nextCursor || isLoadingMore) {
      return
    }
    setIsLoadingMore(true)
    setLoadMoreError(undefined)
    try {
      const result = await window.ledgerpage.listAuditEntries({
        ...appliedFilterInput,
        cursor: state.nextCursor
      })
      if (!result.success) {
        setLoadMoreError(
          isAuthErrorCode(result.errorCode)
            ? 'You\u2019re no longer able to view this. Try signing in again.'
            : 'Something went wrong loading more entries.'
        )
        return
      }
      const readyState = state
      setState({
        kind: 'ready',
        entries: [...readyState.entries, ...result.entries],
        nextCursor: result.nextCursor
      })
    } catch {
      setLoadMoreError('Something went wrong loading more entries.')
    } finally {
      setIsLoadingMore(false)
    }
  }

  return (
    <div style={auditPageStyle}>
      <div style={auditFilterBarStyle}>
        <h1 style={auditHeadingStyle}>Audit Log</h1>

        <div style={auditFilterControlsStyle}>
          <div style={auditFieldGroupStyle}>
            <label htmlFor="audit-entity-type-filter" style={auditLabelStyle}>
              Entity type
            </label>
            <select
              id="audit-entity-type-filter"
              value={entityTypeFilter}
              onChange={(event) => setEntityTypeFilter(event.target.value)}
              style={auditFieldStyle()}
            >
              <option value="">All types</option>
              {KNOWN_ENTITY_TYPES.map((entityType) => (
                <option key={entityType} value={entityType}>
                  {entityType}
                </option>
              ))}
            </select>
          </div>

          <div style={auditFieldGroupStyle}>
            <label htmlFor="audit-from-date" style={auditLabelStyle}>
              From
            </label>
            <input
              id="audit-from-date"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              style={auditFieldStyle(Boolean(fromError))}
              aria-invalid={fromError ? true : undefined}
              aria-describedby={fromError ? 'audit-from-date-error' : undefined}
            />
            {fromError && (
              <span id="audit-from-date-error" role="alert" style={auditFieldErrorTextStyle}>
                {fromError}
              </span>
            )}
          </div>

          <div style={auditFieldGroupStyle}>
            <label htmlFor="audit-to-date" style={auditLabelStyle}>
              To
            </label>
            <input
              id="audit-to-date"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              style={auditFieldStyle(Boolean(toError))}
              aria-invalid={toError ? true : undefined}
              aria-describedby={toError ? 'audit-to-date-error' : undefined}
            />
            {toError && (
              <span id="audit-to-date-error" role="alert" style={auditFieldErrorTextStyle}>
                {toError}
              </span>
            )}
          </div>

          <button type="button" onClick={reload} style={auditPrimaryButtonStyle}>
            Apply filters
          </button>
        </div>
      </div>

      {rangeError && (
        <span
          role="alert"
          style={{ ...auditFieldErrorTextStyle, display: 'block', marginBottom: '0.875rem' }}
        >
          {rangeError}
        </span>
      )}

      {state.kind === 'loading' && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>Loading&hellip;</p>
      )}

      {state.kind === 'unauthorized' && (
        <div style={auditBannerStyle}>
          You don&rsquo;t have access to the audit log, or your session is no longer active.
        </div>
      )}

      {state.kind === 'error' && (
        <div style={auditBannerStyle}>
          Couldn&rsquo;t load the audit log. Try reloading the app.
        </div>
      )}

      {state.kind === 'ready' && state.entries.length === 0 && (
        <p style={{ color: auditColors.mutedInk, fontSize: '0.8125rem' }}>
          No audit entries match these filters.
        </p>
      )}

      {state.kind === 'ready' && state.entries.length > 0 && (
        <>
          <div style={auditPanelStyle}>
            <table style={auditTableStyle}>
              <thead>
                <tr style={auditHeaderRowStyle}>
                  <th style={auditHeaderCellStyle}>When</th>
                  <th style={auditHeaderCellStyle}>Actor</th>
                  <th style={auditHeaderCellStyle}>Action</th>
                  <th style={auditHeaderCellStyle}>Entity</th>
                  <th style={auditHeaderCellStyle}>Changes</th>
                </tr>
              </thead>
              <tbody>
                {state.entries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    style={{
                      borderBottom:
                        index === state.entries.length - 1
                          ? 'none'
                          : `1px solid ${auditColors.border}`
                    }}
                  >
                    <td
                      style={{
                        ...auditBodyCellStyle,
                        whiteSpace: 'nowrap',
                        color: auditColors.mutedInk,
                        fontVariantNumeric: 'tabular-nums'
                      }}
                    >
                      {formatTimestamp(entry.occurredAt)}
                    </td>
                    <td style={auditBodyCellStyle}>{entry.actorLabel}</td>
                    <td style={auditBodyCellStyle}>
                      <span style={auditActionBadgeStyle(entry.action)}>{entry.action}</span>
                    </td>
                    <td style={auditBodyCellStyle}>
                      <span style={{ color: auditColors.faintInk }}>{entry.entityType}:</span>{' '}
                      {entry.entityLabel}
                    </td>
                    <td style={auditBodyCellStyle}>
                      {entry.changedFields ? (
                        <details>
                          <summary
                            style={{
                              cursor: 'pointer',
                              color: auditColors.mutedInk,
                              fontSize: '0.8125rem'
                            }}
                          >
                            {summarizeChangedFieldCount(Object.keys(entry.changedFields).length)}
                          </summary>
                          <ul style={{ margin: '0.375rem 0 0', paddingLeft: '1.125rem' }}>
                            {Object.entries(entry.changedFields).map(([field, change]) => (
                              <li key={field} style={{ marginBottom: '0.125rem' }}>
                                {field}: {renderFieldValue(change.old)} &rarr;{' '}
                                {renderFieldValue(change.new)}
                              </li>
                            ))}
                          </ul>
                        </details>
                      ) : (
                        '\u2014'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {loadMoreError && <div style={auditBannerStyle}>{loadMoreError}</div>}

          {state.nextCursor && (
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={() => void handleLoadMore()}
                disabled={isLoadingMore}
                style={{
                  ...auditGhostButtonStyle,
                  cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                  opacity: isLoadingMore ? 0.7 : 1
                }}
              >
                {isLoadingMore ? 'Loading\u2026' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

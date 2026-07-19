import { useCallback, useEffect, useState } from 'react'
import { CreateUserForm } from './CreateUserForm'
import { colors, errorBannerStyle, headingStyle, primaryButtonStyle } from '../setup/ui'
import type { SafeUserListItem } from '../../../shared/ipc/users'

type LoadState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; users: SafeUserListItem[] }

function fetchUsers(setState: (next: LoadState) => void): void {
  window.ledgerpage
    .listUsers()
    .then((result) => {
      if (!result.success) {
        setState({ kind: 'error' })
        return
      }
      setState({ kind: 'ready', users: result.users })
    })
    .catch(() => {
      setState({ kind: 'error' })
    })
}

/**
 * Reachable in this renderer only from AuthenticatedShell's Owner-only
 * link — but that link is a cosmetic convenience, not the actual
 * boundary. Every call this screen makes (listUsers, createUser,
 * deactivateUser, reactivateUser) is independently re-authorized by
 * the main process from live SQLite role data; a non-Owner reaching
 * this screen through some other path (a stale build, a direct IPC
 * call) still gets a uniform "not authorized" result from every one of
 * them, never partial data.
 */
export function UsersAndRolesScreen() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [isCreating, setIsCreating] = useState(false)
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const [pendingUserId, setPendingUserId] = useState<string | undefined>(undefined)

  // Only ever called from event handlers below (a button click, a
  // post-mutation refresh) — never from within an effect body, where
  // this synchronous setState-then-fetch shape would trigger cascading
  // renders. The mount effect below calls fetchUsers directly instead,
  // with no synchronous setState of its own, matching React's own
  // "subscribe, then setState inside the async callback" guidance for
  // effects.
  const reload = useCallback(() => {
    setState({ kind: 'loading' })
    fetchUsers(setState)
  }, [])

  useEffect(() => {
    fetchUsers(setState)
  }, [])

  async function handleToggleActive(user: SafeUserListItem): Promise<void> {
    setRowError(undefined)
    setPendingUserId(user.id)
    try {
      const result = user.isActive
        ? await window.ledgerpage.deactivateUser({ userId: user.id })
        : await window.ledgerpage.reactivateUser({ userId: user.id })
      if (!result.success) {
        setRowError(describeMutateError(result.errorCode))
        return
      }
      reload()
    } catch {
      setRowError('Something went wrong. Try again.')
    } finally {
      setPendingUserId(undefined)
    }
  }

  return (
    <div style={{ padding: '2rem 1.5rem', maxWidth: '48rem', margin: '0 auto' }}>
      <h1 style={headingStyle}>Users &amp; Roles</h1>

      {state.kind === 'loading' && <p style={{ color: colors.mutedInk }}>Loading&hellip;</p>}

      {state.kind === 'error' && (
        <div style={errorBannerStyle}>Couldn&rsquo;t load users. Try reloading the app.</div>
      )}

      {state.kind === 'ready' && (
        <>
          {rowError && <div style={errorBannerStyle}>{rowError}</div>}

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${colors.border}`, textAlign: 'left' }}>
                <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}>Name</th>
                <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}>Username</th>
                <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}>Role</th>
                <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}>Status</th>
                <th style={{ padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }} />
              </tr>
            </thead>
            <tbody>
              {state.users.map((user) => (
                <tr key={user.id} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
                    {user.displayName}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
                    {user.loginIdentifier}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
                    {user.roleCode ?? '\u2014'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}>
                    {user.isActive ? 'Active' : 'Deactivated'}
                  </td>
                  <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                    {user.roleCode !== 'owner' && (
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(user)}
                        disabled={pendingUserId === user.id}
                        style={{
                          fontSize: '0.8125rem',
                          color: user.isActive ? colors.error : colors.accent,
                          background: 'none',
                          border: `1px solid ${colors.border}`,
                          borderRadius: '0.375rem',
                          padding: '0.25rem 0.625rem',
                          cursor: pendingUserId === user.id ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {user.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {isCreating ? (
            <CreateUserForm
              onCreated={() => {
                setIsCreating(false)
                reload()
              }}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              style={primaryButtonStyle(false)}
            >
              Add user
            </button>
          )}
        </>
      )}
    </div>
  )
}

function describeMutateError(errorCode: string): string {
  switch (errorCode) {
    case 'cannot_modify_owner':
      return 'The Owner account can\u2019t be changed here.'
    case 'not_authorized':
    case 'session_invalid':
      return 'You\u2019re no longer able to make this change. Try signing in again.'
    default:
      return 'Something went wrong. Try again.'
  }
}

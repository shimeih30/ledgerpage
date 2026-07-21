import { useState } from 'react'
import { UsersAndRolesScreen } from '../users/UsersAndRolesScreen'
import { AuditLogScreen } from '../audit/AuditLogScreen'
import { colors, fonts } from '../setup/ui'
import type { SafeSessionInfo } from '../../../shared/ipc/login'

interface AuthenticatedShellProps {
  session: SafeSessionInfo
  onLoggedOut: () => void
}

type View = 'home' | 'users' | 'audit'

/**
 * The authenticated application area. The "Users & Roles" link is
 * rendered only when `session.isOwner` is true, and the "Audit Log"
 * link only when `session.canViewAuditLog` is true — both purely
 * cosmetic conveniences, not security boundaries: the actual
 * enforcement lives entirely in the main process (userManagementService
 * and requireAuthorizedCaller's own fresh, SQLite-sourced authorization
 * checks on every call), exactly per the acceptance criterion that an
 * unauthorized caller must be blocked there regardless of what this
 * renderer shows or hides.
 */
export function AuthenticatedShell({ session, onLoggedOut }: AuthenticatedShellProps) {
  const [view, setView] = useState<View>('home')

  async function handleLogout(): Promise<void> {
    try {
      await window.ledgerpage.logout()
    } finally {
      onLoggedOut()
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafafa' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.5rem',
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <button
          type="button"
          onClick={() => setView('home')}
          style={{
            fontFamily: fonts.display,
            fontSize: '1.0625rem',
            fontWeight: 600,
            color: colors.ink,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0
          }}
        >
          LedgerPage
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontSize: '0.875rem', color: colors.mutedInk }}>
            {session.displayName}
          </span>
          {session.isOwner && (
            <button
              type="button"
              onClick={() => setView('users')}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'users' ? 700 : 500
              }}
            >
              Users &amp; Roles
            </button>
          )}
          {session.canViewAuditLog && (
            <button
              type="button"
              onClick={() => setView('audit')}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'audit' ? 700 : 500
              }}
            >
              Audit Log
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            style={{
              fontSize: '0.875rem',
              color: colors.mutedInk,
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: '0.375rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer'
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {view === 'users' && <UsersAndRolesScreen />}
      {view === 'audit' && <AuditLogScreen />}
      {view === 'home' && (
        <main
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 1.5rem',
            fontFamily: 'system-ui, sans-serif',
            color: '#1a1a1a'
          }}
        >
          <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>LedgerPage</h1>
          <p style={{ color: '#666', marginTop: '0.5rem' }}>Slice 1 — application shell</p>
        </main>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { LoginScreen } from './LoginScreen'
import { LockScreen } from './LockScreen'
import { AuthenticatedShell } from './AuthenticatedShell'
import { useIdleLock } from './useIdleLock'
import { pageStyle } from '../setup/ui'
import type { SafeSessionInfo, SessionState } from '../../../shared/ipc/login'

type AuthAppState =
  | { kind: 'checking' }
  | { kind: 'logged_out' }
  | { kind: 'locked'; displayName: string }
  | { kind: 'active'; session: SafeSessionInfo }

const SESSION_POLL_MS = 5_000

function toAuthAppState(sessionState: SessionState): AuthAppState {
  if (sessionState.state === 'logged_out') {
    return { kind: 'logged_out' }
  }
  if (sessionState.state === 'locked') {
    return { kind: 'locked', displayName: sessionState.displayName }
  }
  return {
    kind: 'active',
    session: {
      displayName: sessionState.displayName,
      isOwner: sessionState.isOwner,
      canViewAuditLog: sessionState.canViewAuditLog
    }
  }
}

/**
 * Owns the whole post-setup session lifecycle: an initial check on
 * mount, then a fixed poll (getSessionState — a pure read, see its own
 * doc comment) that is how this renderer discovers a lock the main
 * process's own idle timer triggered autonomously, without needing a
 * push-event channel. The poll and the separate activity-driven
 * touchSession() call (via useIdleLock, only attached while a session
 * is genuinely active) are deliberately independent mechanisms —
 * merely polling for state must never itself count as activity, or
 * the idle lock could never actually trigger.
 */
export function AuthenticatedApp() {
  const [state, setState] = useState<AuthAppState>({ kind: 'checking' })

  const refreshSessionState = useCallback(() => {
    window.ledgerpage
      .getSessionState()
      .then((sessionState) => {
        setState(toAuthAppState(sessionState))
      })
      .catch(() => {
        setState({ kind: 'logged_out' })
      })
  }, [])

  useEffect(() => {
    refreshSessionState()
  }, [refreshSessionState])

  useEffect(() => {
    const interval = setInterval(refreshSessionState, SESSION_POLL_MS)
    return () => {
      clearInterval(interval)
    }
  }, [refreshSessionState])

  useIdleLock(state.kind === 'active')

  if (state.kind === 'checking') {
    return (
      <div style={pageStyle}>
        <p style={{ color: '#5B6472', fontSize: '0.875rem' }}>Loading&hellip;</p>
      </div>
    )
  }

  if (state.kind === 'logged_out') {
    return <LoginScreen onLoggedIn={(session) => setState({ kind: 'active', session })} />
  }

  if (state.kind === 'locked') {
    return (
      <LockScreen
        displayName={state.displayName}
        onUnlocked={(session) => setState({ kind: 'active', session })}
      />
    )
  }

  return (
    <AuthenticatedShell
      session={state.session}
      onLoggedOut={() => setState({ kind: 'logged_out' })}
    />
  )
}

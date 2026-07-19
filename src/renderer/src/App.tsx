import { useEffect, useState } from 'react'
import { AuthenticatedApp } from './auth/AuthenticatedApp'
import { InconsistentStateScreen } from './InconsistentStateScreen'
import { SetupWizard } from './setup/SetupWizard'
import { pageStyle } from './setup/ui'
import type { FirstRunStatus } from '../../shared/ipc/setup'

type AppState = { kind: 'loading' } | { kind: 'ready'; status: FirstRunStatus } | { kind: 'error' }

/**
 * The single first-run router: asks the main process — never anything
 * renderer-local — what state the application is in, and shows
 * exactly one of three things. A failed status check (the IPC call
 * itself throwing) is treated the same as inconsistent_state: if this
 * renderer cannot even determine whether setup is needed, the safest
 * response is the same fail-closed screen, not a guess.
 *
 * Once setup_complete, everything session-related — login, lock,
 * logout, and the authenticated shell itself — is AuthenticatedApp's
 * own concern (Slice 9), not this router's.
 */
function App() {
  const [state, setState] = useState<AppState>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false

    window.ledgerpage
      .getFirstRunStatus()
      .then((status) => {
        if (!cancelled) {
          setState({ kind: 'ready', status })
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({ kind: 'error' })
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (state.kind === 'loading') {
    return (
      <div style={pageStyle}>
        <p style={{ color: '#5B6472', fontSize: '0.875rem' }}>Loading&hellip;</p>
      </div>
    )
  }

  if (state.kind === 'error' || state.status.status === 'inconsistent_state') {
    return <InconsistentStateScreen />
  }

  if (state.status.status === 'setup_required') {
    return <SetupWizard />
  }

  return <AuthenticatedApp />
}

export default App

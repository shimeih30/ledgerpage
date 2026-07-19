import { useState, type FormEvent } from 'react'
import { FormField } from '../setup/FormField'
import {
  cardStyle,
  errorBannerStyle,
  headingStyle,
  pageStyle,
  primaryButtonStyle,
  subheadingStyle
} from '../setup/ui'
import type { SafeSessionInfo } from '../../../shared/ipc/login'

interface LoginScreenProps {
  onLoggedIn: (session: SafeSessionInfo) => void
}

/**
 * Deliberately generic on failure — "that username or password isn't
 * right" regardless of whether the identifier doesn't exist, the
 * password is wrong, or the account is locked/deactivated. The main
 * process's authenticate() already guarantees this anti-enumeration
 * property; this screen doesn't have — and must not invent — any
 * finer-grained information to display instead.
 */
export function LoginScreen({ onLoggedIn }: LoginScreenProps) {
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (isBusy || loginIdentifier.trim().length === 0 || password.length === 0) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    try {
      const result = await window.ledgerpage.login({ loginIdentifier, password })
      if (!result.success) {
        setError('That username or password isn\u2019t right.')
        return
      }
      onLoggedIn(result.session)
    } catch {
      setError('Something went wrong signing you in. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <h1 style={headingStyle}>Sign in to LedgerPage</h1>
          <p style={subheadingStyle}>Enter your username and password to continue.</p>

          {error && <div style={errorBannerStyle}>{error}</div>}

          <FormField
            id="login-identifier"
            label="Username"
            value={loginIdentifier}
            onChange={setLoginIdentifier}
            autoComplete="username"
            disabled={isBusy}
            autoFocus
          />
          <FormField
            id="login-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={isBusy}
          />

          <button
            type="submit"
            disabled={isBusy || loginIdentifier.trim().length === 0 || password.length === 0}
            style={primaryButtonStyle(
              isBusy || loginIdentifier.trim().length === 0 || password.length === 0
            )}
          >
            {isBusy ? 'Signing in\u2026' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

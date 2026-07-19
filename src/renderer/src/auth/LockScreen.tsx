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

interface LockScreenProps {
  displayName: string
  onUnlocked: (session: SafeSessionInfo) => void
}

/**
 * Deliberately shows only the signed-in user's name and a password
 * field — never a username field, never a way to switch to a
 * different account from here. Resuming a locked session must always
 * mean "prove you're still the same person," not "sign in as anyone."
 */
export function LockScreen({ displayName, onUnlocked }: LockScreenProps) {
  const [password, setPassword] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (isBusy || password.length === 0) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    try {
      const result = await window.ledgerpage.unlockSession({ password })
      if (!result.success) {
        setError('That password isn\u2019t right. Try again.')
        setPassword('')
        return
      }
      onUnlocked(result.session)
    } catch {
      setError('Something went wrong unlocking. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <form onSubmit={(event) => void handleSubmit(event)} noValidate>
          <h1 style={headingStyle}>Welcome back, {displayName}</h1>
          <p style={subheadingStyle}>Enter your password to resume where you left off.</p>

          {error && <div style={errorBannerStyle}>{error}</div>}

          <FormField
            id="lock-password"
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={isBusy}
            autoFocus
          />

          <button
            type="submit"
            disabled={isBusy || password.length === 0}
            style={primaryButtonStyle(isBusy || password.length === 0)}
          >
            {isBusy ? 'Unlocking\u2026' : 'Unlock'}
          </button>
        </form>
      </div>
    </div>
  )
}

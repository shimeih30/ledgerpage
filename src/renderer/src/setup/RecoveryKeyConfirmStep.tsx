import { useState, type FormEvent } from 'react'
import { FormField } from './FormField'
import {
  errorBannerStyle,
  headingStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subheadingStyle
} from './ui'

interface RecoveryKeyConfirmStepProps {
  isSubmitting: boolean
  submitError: string | undefined
  onSubmit: (reenteredKey: string) => void
  onRegenerateKey: () => void
}

/**
 * Re-entry is verified entirely server-side (RecoveryCeremonyService's
 * confirmCeremony, via IPC) — this component never compares the typed
 * value against anything it holds itself, because it holds nothing:
 * the plaintext key was already discarded by the previous step. A
 * wrong entry is retryable against the same ceremony; "generate a new
 * key" is the explicit escape hatch back to a fresh display step,
 * never a silent one.
 */
export function RecoveryKeyConfirmStep({
  isSubmitting,
  submitError,
  onSubmit,
  onRegenerateKey
}: RecoveryKeyConfirmStepProps) {
  const [reenteredKey, setReenteredKey] = useState('')

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    if (isSubmitting || reenteredKey.trim().length === 0) {
      return
    }
    onSubmit(reenteredKey.trim())
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 style={headingStyle}>Confirm your recovery key</h1>
      <p style={subheadingStyle}>
        Type the key you just saved to confirm you recorded it correctly.
      </p>

      {submitError && <div style={errorBannerStyle}>{submitError}</div>}

      <FormField
        id="recovery-key-reentry"
        label="Recovery key"
        value={reenteredKey}
        onChange={setReenteredKey}
        autoComplete="off"
        disabled={isSubmitting}
        autoFocus
      />

      <button
        type="submit"
        disabled={isSubmitting || reenteredKey.trim().length === 0}
        style={primaryButtonStyle(isSubmitting || reenteredKey.trim().length === 0)}
      >
        {isSubmitting ? 'Confirming\u2026' : 'Confirm'}
      </button>
      <button
        type="button"
        onClick={onRegenerateKey}
        disabled={isSubmitting}
        style={secondaryButtonStyle}
      >
        Generate a new key instead
      </button>
    </form>
  )
}

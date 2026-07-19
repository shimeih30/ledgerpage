import { useState } from 'react'
import {
  checkboxRowStyle,
  colors,
  errorBannerStyle,
  headingStyle,
  monoBoxStyle,
  primaryButtonStyle,
  subheadingStyle
} from './ui'

interface RecoveryKeyDisplayStepProps {
  plaintextRecoveryKey: string
  onAcknowledge: () => void
}

/**
 * The one and only place the plaintext recovery key is ever shown.
 * Continuing past this screen requires an explicit "I have saved this
 * key" checkbox — SetupWizard discards the plaintext from its own
 * state the moment that happens (see its onAcknowledge handler), so
 * there is no code path back to re-displaying it: this component
 * simply won't be rendered with a key again afterward.
 */
export function RecoveryKeyDisplayStep({
  plaintextRecoveryKey,
  onAcknowledge
}: RecoveryKeyDisplayStepProps) {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <div>
      <h1 style={headingStyle}>Save your recovery key</h1>
      <p style={subheadingStyle}>
        This key is the only way back into LedgerPage if the Owner password is ever lost. It is
        shown once, right now, and never again.
      </p>

      <div style={errorBannerStyle}>
        Write this down or store it somewhere safe before continuing. You won&rsquo;t be able to see
        it again.
      </div>

      <p aria-label="Recovery key" style={monoBoxStyle}>
        {plaintextRecoveryKey}
      </p>

      <label htmlFor="recovery-key-acknowledged" style={checkboxRowStyle}>
        <input
          id="recovery-key-acknowledged"
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
          style={{ marginTop: '0.1875rem' }}
        />
        <span style={{ fontSize: '0.875rem', color: colors.ink }}>
          I have saved this recovery key somewhere safe.
        </span>
      </label>

      <button
        type="button"
        onClick={onAcknowledge}
        disabled={!acknowledged}
        style={primaryButtonStyle(!acknowledged)}
      >
        Continue
      </button>
    </div>
  )
}

import type { ReactNode } from 'react'
import { cardStyle, colors, fonts, pageStyle, WIZARD_STEP_LABELS } from './ui'

interface WizardShellProps {
  /** 0-based index into WIZARD_STEP_LABELS, or undefined to hide the trail (used by the completion screen). */
  activeStepIndex?: number
  children: ReactNode
}

/**
 * Shared chrome for every setup screen: the page background, the
 * centered card, and — the one deliberate signature element in this
 * wizard, kept quiet everywhere else — a labeled progress trail across
 * the top of the card. Each segment shows a checkmark once passed, a
 * filled accent dot for the current step, and a plain outline for
 * what's ahead, so "clear progress through the setup stages" is
 * always visible without narrating it in prose on every screen.
 */
export function WizardShell({ activeStepIndex, children }: WizardShellProps) {
  return (
    <div style={pageStyle}>
      <div style={{ width: '100%', maxWidth: '30rem', marginBottom: '1.5rem' }}>
        <p
          style={{
            fontFamily: fonts.display,
            fontSize: '1.0625rem',
            fontWeight: 600,
            color: colors.ink,
            margin: 0,
            textAlign: 'center'
          }}
        >
          LedgerPage
        </p>
      </div>

      {activeStepIndex !== undefined && (
        <nav
          aria-label="Setup progress"
          style={{ width: '100%', maxWidth: '30rem', marginBottom: '1rem' }}
        >
          <ol
            style={{
              display: 'flex',
              listStyle: 'none',
              margin: 0,
              padding: 0,
              gap: '0.5rem'
            }}
          >
            {WIZARD_STEP_LABELS.map((label, index) => {
              const isComplete = index < activeStepIndex
              const isCurrent = index === activeStepIndex
              return (
                <li
                  key={label}
                  aria-current={isCurrent ? 'step' : undefined}
                  style={{ flex: 1, textAlign: 'center' }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      height: '0.25rem',
                      borderRadius: '999px',
                      backgroundColor: isComplete || isCurrent ? colors.accent : colors.border,
                      marginBottom: '0.375rem'
                    }}
                  />
                  <span
                    style={{
                      fontSize: '0.6875rem',
                      fontWeight: isCurrent ? 700 : 500,
                      color: isCurrent ? colors.accent : colors.mutedInk
                    }}
                  >
                    {isComplete ? '✓ ' : ''}
                    {label}
                  </span>
                </li>
              )
            })}
          </ol>
        </nav>
      )}

      <div style={cardStyle}>{children}</div>
    </div>
  )
}

import { colors, headingStyle, subheadingStyle } from './ui'

/**
 * No automatic session or login here — Slice 8's flow ends at
 * "completion" (see the M1 plan's own description of this slice), and
 * ordinary login/navigation is Slice 9's job. This screen only
 * confirms success; it never claims the person is now signed in.
 */
export function CompletionStep() {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        aria-hidden="true"
        style={{
          width: '3rem',
          height: '3rem',
          borderRadius: '999px',
          backgroundColor: colors.accentSoft,
          color: colors.accent,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.5rem',
          margin: '0 auto 1.25rem auto'
        }}
      >
        ✓
      </div>
      <h1 style={headingStyle}>You&rsquo;re all set</h1>
      <p style={subheadingStyle}>
        LedgerPage is ready. Sign in with the Owner account you just created to get started.
      </p>
    </div>
  )
}

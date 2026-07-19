import { colors, fonts, headingStyle, primaryButtonStyle, subheadingStyle } from './ui'

interface CurrencyConfirmationStepProps {
  onContinue: () => void
  onBack: () => void
}

/**
 * A confirmation, not a picker — LedgerPage's functional currency is a
 * fixed architectural decision (US Dollars), not a per-company setting
 * this wizard can change. Other currencies remain available elsewhere
 * for reference bookkeeping, which this screen says plainly rather
 * than implying a choice exists here.
 */
export function CurrencyConfirmationStep({ onContinue, onBack }: CurrencyConfirmationStepProps) {
  return (
    <div>
      <h1 style={headingStyle}>Your functional currency</h1>
      <p style={subheadingStyle}>
        LedgerPage tracks your business in US Dollars (USD). Amounts in other currencies can still
        be recorded for reference.
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '1rem 1.125rem',
          backgroundColor: colors.accentSoft,
          border: `1px solid ${colors.border}`,
          borderRadius: '0.5rem',
          marginBottom: '1.5rem'
        }}
      >
        <span style={{ fontFamily: fonts.display, fontSize: '1.375rem', fontWeight: 600 }}>$</span>
        <div>
          <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9375rem' }}>US Dollar</p>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: colors.mutedInk }}>USD</p>
        </div>
      </div>

      <button type="button" onClick={onContinue} style={primaryButtonStyle(false)}>
        Confirm and continue
      </button>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          marginTop: '0.75rem',
          padding: '0.5rem',
          fontSize: '0.8125rem',
          color: colors.mutedInk,
          background: 'none',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Back
      </button>
    </div>
  )
}

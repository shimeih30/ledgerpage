import { colors, fonts, headingStyle, pageStyle, subheadingStyle } from './setup/ui'

/**
 * Shown only when firstRunStatusService reports inconsistent_state —
 * deliberately never auto-repaired anywhere in the main process, so
 * this screen's only job is to say, plainly, that something needs
 * attention, without exposing database/security terminology (no
 * mention of tables, roles, credentials, or the specific check that
 * failed — that detail exists only in the main process's own
 * diagnostics).
 */
export function InconsistentStateScreen() {
  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: '26rem', textAlign: 'center' }}>
        <p
          style={{
            fontFamily: fonts.display,
            fontSize: '1.0625rem',
            fontWeight: 600,
            margin: '0 0 1.5rem 0'
          }}
        >
          LedgerPage
        </p>
        <h1 style={headingStyle}>Setup could not be verified</h1>
        <p style={{ ...subheadingStyle, color: colors.ink }}>
          LedgerPage found unexpected data on this computer and stopped before making any changes.
          Nothing has been modified. Please contact support for help resolving this before
          continuing.
        </p>
      </div>
    </div>
  )
}

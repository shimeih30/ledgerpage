import type { CSSProperties } from 'react'

/**
 * A small, dedicated token set for the Audit Log screen only —
 * deliberately not added to setup/ui.ts, which SetupWizard, LoginScreen,
 * LockScreen, UsersAndRolesScreen, and CreateUserForm all share. This
 * screen's visual language (a restrained medium blue, a cooler pale-
 * neutral background, compact ERP-style density) is intentionally
 * different from setup/ui.ts's warm-cream/serif/ledger-green language,
 * so introducing a second, narrowly-scoped module avoids any risk of
 * visually affecting those unrelated screens.
 *
 * Operational-minimalism direction: a single continuous white working
 * surface per view (never per-row cards), hairline borders, no shadows
 * beyond a 1px border, color reserved for the primary action, active
 * navigation, and status/action badges — never decorative. No
 * gradients, no glassmorphism, no illustration.
 */
export const auditColors = {
  pageBackground: '#F3F4F6',
  surface: '#FFFFFF',
  border: '#E2E4E8',
  borderStrong: '#CDD1D7',
  headerBackground: '#F8F9FB',
  rowHover: '#FAFBFC',
  ink: '#1A1D23',
  mutedInk: '#6B7280',
  faintInk: '#9CA3AF',
  accent: '#2F5FE0',
  accentHover: '#2247B8',
  accentSoft: '#EAF0FE',
  error: '#B3261E',
  errorSoft: '#FBEAE9',
  focusRing: '#2F5FE0',
  redactedBg: '#F3F4F6',
  redactedText: '#5B6472',
  statusCreateBg: '#EAF3DE',
  statusCreateText: '#27500A',
  statusUpdateBg: '#E6F1FB',
  statusUpdateText: '#0C447C',
  statusWarnBg: '#FAEEDA',
  statusWarnText: '#633806'
} as const

export const auditFonts = {
  body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
} as const

export const auditPageStyle: CSSProperties = {
  minHeight: '100%',
  backgroundColor: auditColors.pageBackground,
  fontFamily: auditFonts.body,
  color: auditColors.ink,
  padding: '1.5rem'
}

export const auditHeadingStyle: CSSProperties = {
  fontSize: '1.0625rem',
  fontWeight: 600,
  margin: 0,
  lineHeight: 1.3
}

export const auditFilterBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '0.625rem',
  marginBottom: '0.875rem'
}

export const auditFilterControlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '0.5rem'
}

export const auditLabelStyle: CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: auditColors.mutedInk
}

export const auditFieldGroupStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem'
}

export const auditFieldErrorTextStyle: CSSProperties = {
  fontSize: '0.6875rem',
  color: auditColors.error
}

export function auditFieldStyle(hasError = false): CSSProperties {
  return {
    fontSize: '0.8125rem',
    padding: '0.3125rem 0.5rem',
    fontFamily: auditFonts.body,
    color: auditColors.ink,
    backgroundColor: auditColors.surface,
    border: `1px solid ${hasError ? auditColors.error : auditColors.border}`,
    borderRadius: '5px',
    outlineColor: hasError ? auditColors.error : auditColors.focusRing
  }
}

export const auditPrimaryButtonStyle: CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 600,
  fontFamily: auditFonts.body,
  padding: '0.3125rem 0.75rem',
  color: '#FFFFFF',
  backgroundColor: auditColors.accent,
  border: 'none',
  borderRadius: '5px',
  cursor: 'pointer'
}

export const auditGhostButtonStyle: CSSProperties = {
  fontSize: '0.8125rem',
  fontWeight: 500,
  fontFamily: auditFonts.body,
  color: auditColors.accent,
  backgroundColor: 'transparent',
  border: 'none',
  padding: '0.375rem 0',
  cursor: 'pointer'
}

export const auditPanelStyle: CSSProperties = {
  backgroundColor: auditColors.surface,
  border: `1px solid ${auditColors.border}`,
  borderRadius: '6px',
  overflowX: 'auto'
}

export const auditTableStyle: CSSProperties = {
  width: '100%',
  minWidth: '40rem',
  borderCollapse: 'collapse',
  fontSize: '0.8125rem'
}

export const auditHeaderRowStyle: CSSProperties = {
  backgroundColor: auditColors.headerBackground,
  borderBottom: `1px solid ${auditColors.border}`,
  textAlign: 'left'
}

export const auditHeaderCellStyle: CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.6875rem',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: auditColors.mutedInk,
  whiteSpace: 'nowrap'
}

export const auditBodyCellStyle: CSSProperties = {
  padding: '0.5rem 0.75rem',
  verticalAlign: 'top'
}

export const auditBannerStyle: CSSProperties = {
  backgroundColor: auditColors.errorSoft,
  color: auditColors.error,
  border: `1px solid ${auditColors.error}`,
  borderRadius: '5px',
  padding: '0.625rem 0.875rem',
  fontSize: '0.8125rem',
  marginBottom: '0.875rem'
}

/**
 * Small color-coded status badge for the Action column — the one place
 * beyond the primary button where this screen uses color deliberately,
 * to carry event-type meaning at a glance. create/reactivate read as a
 * routine, positive event (green); update is a neutral, informational
 * one (blue); deactivate is the one cautionary action (amber).
 */
export function auditActionBadgeStyle(action: string): CSSProperties {
  let backgroundColor: string
  let color: string
  if (action === 'deactivate') {
    backgroundColor = auditColors.statusWarnBg
    color = auditColors.statusWarnText
  } else if (action === 'update') {
    backgroundColor = auditColors.statusUpdateBg
    color = auditColors.statusUpdateText
  } else {
    // create, reactivate
    backgroundColor = auditColors.statusCreateBg
    color = auditColors.statusCreateText
  }
  return {
    display: 'inline-block',
    fontSize: '0.6875rem',
    fontWeight: 600,
    padding: '0.125rem 0.4375rem',
    borderRadius: '4px',
    backgroundColor,
    color
  }
}

export const auditRedactedPillStyle: CSSProperties = {
  display: 'inline-block',
  fontFamily: auditFonts.mono,
  fontSize: '0.6875rem',
  padding: '0.0625rem 0.375rem',
  borderRadius: '3px',
  backgroundColor: auditColors.redactedBg,
  color: auditColors.redactedText
}

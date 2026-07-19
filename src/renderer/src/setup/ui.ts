import type { CSSProperties } from 'react'

/**
 * A small, deliberate token set for the first-run setup wizard —
 * LedgerPage's first real screens. Restrained, professional desktop-
 * application design, not a marketing page: a calm, warm neutral
 * background; a deep ledger-green accent (evokes trust and record-
 * keeping without reaching for fintech-blue or the common AI-cream/
 * terracotta pairing); a serif display face for headings (system
 * fonts only — the CSP allows no external font sources — paired
 * deliberately with a sans-serif body face, not the same family used
 * for both). Inline style objects throughout, matching the existing
 * App.tsx and satisfying the CSP's `style-src 'self' 'unsafe-inline'`
 * without needing a new dependency.
 */
export const colors = {
  background: '#F7F5F1',
  surface: '#FFFFFF',
  border: '#DDD8CE',
  ink: '#1E2530',
  mutedInk: '#5B6472',
  accent: '#1F5A3E',
  accentHover: '#173F2C',
  accentSoft: '#E4EEE8',
  error: '#A23B32',
  errorSoft: '#F7E9E7',
  focusRing: '#1F5A3E'
} as const

export const fonts = {
  display: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
} as const

export const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: colors.background,
  fontFamily: fonts.body,
  color: colors.ink,
  padding: '2.5rem 1.5rem'
}

export const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: '30rem',
  backgroundColor: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: '0.75rem',
  padding: '2.25rem 2.5rem',
  boxShadow: '0 1px 3px rgba(30, 37, 48, 0.06)'
}

export const headingStyle: CSSProperties = {
  fontFamily: fonts.display,
  fontSize: '1.5rem',
  fontWeight: 600,
  margin: '0 0 0.5rem 0',
  lineHeight: 1.3
}

export const subheadingStyle: CSSProperties = {
  fontSize: '0.9375rem',
  color: colors.mutedInk,
  margin: '0 0 1.75rem 0',
  lineHeight: 1.5
}

export const fieldGroupStyle: CSSProperties = {
  marginBottom: '1.25rem'
}

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: colors.ink,
  marginBottom: '0.375rem'
}

export function inputStyle(hasError: boolean): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.625rem 0.75rem',
    fontSize: '0.9375rem',
    fontFamily: fonts.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    border: `1px solid ${hasError ? colors.error : colors.border}`,
    borderRadius: '0.375rem',
    outlineColor: colors.focusRing
  }
}

export const helpTextStyle: CSSProperties = {
  fontSize: '0.8125rem',
  color: colors.mutedInk,
  marginTop: '0.375rem'
}

export const errorTextStyle: CSSProperties = {
  fontSize: '0.8125rem',
  color: colors.error,
  marginTop: '0.375rem'
}

export const errorBannerStyle: CSSProperties = {
  backgroundColor: colors.errorSoft,
  color: colors.error,
  border: `1px solid ${colors.error}`,
  borderRadius: '0.5rem',
  padding: '0.75rem 1rem',
  fontSize: '0.875rem',
  marginBottom: '1.25rem'
}

export function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    padding: '0.75rem 1.25rem',
    fontSize: '0.9375rem',
    fontWeight: 600,
    fontFamily: fonts.body,
    color: '#FFFFFF',
    backgroundColor: disabled ? colors.mutedInk : colors.accent,
    border: 'none',
    borderRadius: '0.375rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1
  }
}

export const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  padding: '0.625rem 1.25rem',
  fontSize: '0.875rem',
  fontWeight: 500,
  fontFamily: fonts.body,
  color: colors.accent,
  backgroundColor: 'transparent',
  border: `1px solid ${colors.border}`,
  borderRadius: '0.375rem',
  cursor: 'pointer',
  marginTop: '0.625rem'
}

export const checkboxRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.625rem',
  marginBottom: '1.5rem'
}

export const monoBoxStyle: CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: '1.0625rem',
  letterSpacing: '0.03em',
  color: colors.ink,
  backgroundColor: colors.accentSoft,
  border: `1px solid ${colors.border}`,
  borderRadius: '0.5rem',
  padding: '1rem 1.125rem',
  marginBottom: '1.25rem',
  wordBreak: 'break-all',
  textAlign: 'center'
}

export const WIZARD_STEP_LABELS = [
  'Company',
  'Currency',
  'Owner account',
  'Recovery key',
  'Confirm'
] as const

import { describe, expect, it } from 'vitest'
import { buildContentSecurityPolicy } from '../../src/main/security/contentSecurityPolicy'

describe('buildContentSecurityPolicy', () => {
  it('locks default-src to self in production', () => {
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("default-src 'self'")
  })

  it('never allows unsafe-eval, in production or development', () => {
    expect(buildContentSecurityPolicy()).not.toContain('unsafe-eval')
    expect(buildContentSecurityPolicy('http://localhost:5173')).not.toContain('unsafe-eval')
  })

  it('never contains a wildcard origin', () => {
    expect(buildContentSecurityPolicy()).not.toContain('*')
    expect(buildContentSecurityPolicy('http://localhost:5173')).not.toContain('*')
  })

  it('restricts script-src to self only when no dev server is provided', () => {
    const csp = buildContentSecurityPolicy()
    expect(csp).toContain("script-src 'self'")
  })

  it('trusts the dev server origin (and its websocket) only in development', () => {
    const csp = buildContentSecurityPolicy('http://localhost:5173')
    expect(csp).toContain("script-src 'self' http://localhost:5173")
    expect(csp).toContain('ws://localhost:5173')
  })

  it('denies framing entirely', () => {
    expect(buildContentSecurityPolicy()).toContain("frame-ancestors 'none'")
  })

  it('denies plugin/object content entirely', () => {
    expect(buildContentSecurityPolicy()).toContain("object-src 'none'")
  })
})

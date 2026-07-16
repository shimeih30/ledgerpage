import { describe, expect, it } from 'vitest'
import {
  buildDevelopmentContentSecurityPolicy,
  buildProductionContentSecurityPolicy
} from '../../src/main/security/contentSecurityPolicy'

const DEV_ORIGIN = 'http://localhost:5173'

describe('buildProductionContentSecurityPolicy', () => {
  it('locks default-src to self', () => {
    expect(buildProductionContentSecurityPolicy()).toContain("default-src 'self'")
  })

  it('does not allow unsafe-inline in script-src', () => {
    const csp = buildProductionContentSecurityPolicy()
    const scriptSrcDirective = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrcDirective).toBe("script-src 'self'")
    expect(scriptSrcDirective).not.toContain('unsafe-inline')
  })

  it('never allows unsafe-eval', () => {
    expect(buildProductionContentSecurityPolicy()).not.toContain('unsafe-eval')
  })

  it('never contains a wildcard origin', () => {
    expect(buildProductionContentSecurityPolicy()).not.toContain('*')
  })

  it('does not allow any localhost or loopback development origin', () => {
    const csp = buildProductionContentSecurityPolicy()
    expect(csp).not.toContain('localhost')
    expect(csp).not.toContain('127.0.0.1')
    expect(csp).not.toContain('5173')
    expect(csp).not.toContain('ws:')
  })

  it('denies framing entirely', () => {
    expect(buildProductionContentSecurityPolicy()).toContain("frame-ancestors 'none'")
  })

  it('denies plugin/object content entirely', () => {
    expect(buildProductionContentSecurityPolicy()).toContain("object-src 'none'")
  })

  it('takes no parameters — there is nothing dynamic to widen', () => {
    expect(buildProductionContentSecurityPolicy.length).toBe(0)
  })
})

describe('buildDevelopmentContentSecurityPolicy', () => {
  it('permits inline scripts, required for the Vite React Refresh preamble', () => {
    const csp = buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)
    const scriptSrcDirective = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrcDirective).toContain("'unsafe-inline'")
  })

  it('permits the loopback dev server origin in script-src', () => {
    const csp = buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)
    const scriptSrcDirective = csp.split('; ').find((d) => d.startsWith('script-src'))
    expect(scriptSrcDirective).toContain(DEV_ORIGIN)
  })

  it('permits the loopback HMR WebSocket origin in connect-src', () => {
    const csp = buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)
    const connectSrcDirective = csp.split('; ').find((d) => d.startsWith('connect-src'))
    expect(connectSrcDirective).toContain('ws://localhost:5173')
  })

  it('permits the loopback HTTP origin in connect-src', () => {
    const csp = buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)
    const connectSrcDirective = csp.split('; ').find((d) => d.startsWith('connect-src'))
    expect(connectSrcDirective).toContain(DEV_ORIGIN)
  })

  it('never allows unsafe-eval, even in development', () => {
    expect(buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)).not.toContain('unsafe-eval')
  })

  it('never contains a wildcard origin', () => {
    expect(buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)).not.toContain('*')
  })

  it('works with 127.0.0.1 as the loopback origin', () => {
    const csp = buildDevelopmentContentSecurityPolicy('http://127.0.0.1:5173')
    expect(csp).toContain('http://127.0.0.1:5173')
    expect(csp).toContain('ws://127.0.0.1:5173')
  })

  it('works with IPv6 loopback as the origin', () => {
    const csp = buildDevelopmentContentSecurityPolicy('http://[::1]:5173')
    expect(csp).toContain('http://[::1]:5173')
    expect(csp).toContain('ws://[::1]:5173')
  })

  it('rejects a non-loopback remote origin rather than silently trusting it', () => {
    expect(() => buildDevelopmentContentSecurityPolicy('https://example.com')).toThrow()
  })

  it('rejects a remote-looking LAN origin', () => {
    expect(() => buildDevelopmentContentSecurityPolicy('http://192.168.1.50:5173')).toThrow()
  })

  it('rejects a malformed origin rather than throwing an unrelated error', () => {
    expect(() => buildDevelopmentContentSecurityPolicy('not a url')).toThrow()
  })

  it('does not widen the policy beyond the one provided loopback origin', () => {
    const csp = buildDevelopmentContentSecurityPolicy(DEV_ORIGIN)
    expect(csp).not.toContain('example.com')
    expect(csp).not.toContain('0.0.0.0')
  })
})

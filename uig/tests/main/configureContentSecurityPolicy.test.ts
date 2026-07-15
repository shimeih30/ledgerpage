import { describe, expect, it, vi } from 'vitest'
import {
  configureContentSecurityPolicy,
  type CspConfigurableSession
} from '../../src/main/security/configureContentSecurityPolicy'

function createFakeSession() {
  let registered:
    | ((
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders: Record<string, string[]> }) => void
      ) => void)
    | undefined

  const fake: CspConfigurableSession = {
    webRequest: {
      onHeadersReceived: (listener) => {
        registered = listener
      }
    }
  }

  return { fake, invoke: () => registered }
}

describe('configureContentSecurityPolicy', () => {
  it('registers exactly one onHeadersReceived listener', () => {
    const onHeadersReceived = vi.fn()
    const fake: CspConfigurableSession = { webRequest: { onHeadersReceived } }

    configureContentSecurityPolicy(fake)

    expect(onHeadersReceived).toHaveBeenCalledTimes(1)
  })

  it('injects the Content-Security-Policy header into every response', () => {
    const { fake, invoke } = createFakeSession()
    configureContentSecurityPolicy(fake)

    const callback = vi.fn()
    invoke()?.({ responseHeaders: { 'X-Existing': ['value'] } }, callback)

    expect(callback).toHaveBeenCalledTimes(1)
    const response = callback.mock.calls[0][0]
    expect(response.responseHeaders['Content-Security-Policy']).toEqual([
      expect.stringContaining("default-src 'self'")
    ])
    // Existing headers are preserved, not clobbered.
    expect(response.responseHeaders['X-Existing']).toEqual(['value'])
  })

  it('passes the dev server origin through to the CSP builder', () => {
    const { fake, invoke } = createFakeSession()
    configureContentSecurityPolicy(fake, 'http://localhost:5173')

    const callback = vi.fn()
    invoke()?.({}, callback)

    const response = callback.mock.calls[0][0]
    expect(response.responseHeaders['Content-Security-Policy'][0]).toContain(
      'http://localhost:5173'
    )
  })

  it('removes a pre-existing lowercase content-security-policy header rather than duplicating it', () => {
    const { fake, invoke } = createFakeSession()
    configureContentSecurityPolicy(fake)

    const callback = vi.fn()
    invoke()?.(
      {
        responseHeaders: {
          'content-security-policy': ['default-src *'],
          'X-Other': ['kept']
        }
      },
      callback
    )

    const response = callback.mock.calls[0][0]
    const cspKeys = Object.keys(response.responseHeaders).filter(
      (key) => key.toLowerCase() === 'content-security-policy'
    )

    expect(cspKeys).toEqual(['Content-Security-Policy'])
    expect(response.responseHeaders['Content-Security-Policy']).toEqual([
      expect.stringContaining("default-src 'self'")
    ])
    expect(response.responseHeaders['X-Other']).toEqual(['kept'])
  })

  it('removes a pre-existing mixed-case Content-Security-Policy header rather than duplicating it', () => {
    const { fake, invoke } = createFakeSession()
    configureContentSecurityPolicy(fake)

    const callback = vi.fn()
    invoke()?.({ responseHeaders: { 'CoNtEnT-SeCuRiTy-PoLiCy': ['default-src *'] } }, callback)

    const response = callback.mock.calls[0][0]
    const cspKeys = Object.keys(response.responseHeaders).filter(
      (key) => key.toLowerCase() === 'content-security-policy'
    )

    expect(cspKeys).toEqual(['Content-Security-Policy'])
  })
})

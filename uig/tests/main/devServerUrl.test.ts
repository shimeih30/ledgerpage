import { describe, expect, it } from 'vitest'
import { validateDevServerUrl } from '../../src/main/security/devServerUrl'

describe('validateDevServerUrl', () => {
  it('accepts a valid localhost URL', () => {
    const result = validateDevServerUrl('http://localhost:5173', false)
    expect(result?.origin).toBe('http://localhost:5173')
  })

  it('accepts a valid 127.0.0.1 URL', () => {
    const result = validateDevServerUrl('http://127.0.0.1:5173', false)
    expect(result?.origin).toBe('http://127.0.0.1:5173')
  })

  it('accepts a valid IPv6 loopback URL', () => {
    const result = validateDevServerUrl('http://[::1]:5173', false)
    expect(result?.origin).toBe('http://[::1]:5173')
  })

  it('rejects a remote domain', () => {
    expect(validateDevServerUrl('http://example.com:5173', false)).toBeUndefined()
  })

  it('rejects a remote-looking hostname even on a common dev port', () => {
    expect(validateDevServerUrl('http://192.168.1.50:5173', false)).toBeUndefined()
  })

  it('rejects embedded username/password credentials', () => {
    expect(validateDevServerUrl('http://user:pass@localhost:5173', false)).toBeUndefined()
  })

  it('rejects javascript: URLs', () => {
    expect(validateDevServerUrl('javascript:alert(1)', false)).toBeUndefined()
  })

  it('rejects data: URLs', () => {
    expect(validateDevServerUrl('data:text/html,<h1>hi</h1>', false)).toBeUndefined()
  })

  it('rejects file: URLs', () => {
    expect(validateDevServerUrl('file:///etc/passwd', false)).toBeUndefined()
  })

  it('rejects a malformed value', () => {
    expect(validateDevServerUrl('not a url at all', false)).toBeUndefined()
  })

  it('rejects an empty/undefined value', () => {
    expect(validateDevServerUrl(undefined, false)).toBeUndefined()
    expect(validateDevServerUrl('', false)).toBeUndefined()
  })

  it('ignores even an otherwise-valid URL when the app is packaged', () => {
    expect(validateDevServerUrl('http://localhost:5173', true)).toBeUndefined()
  })

  it('rejects https by default (no concrete local-dev requirement for it yet)', () => {
    expect(validateDevServerUrl('https://localhost:5173', false)).toBeUndefined()
  })
})

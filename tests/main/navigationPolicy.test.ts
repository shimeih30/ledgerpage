import { describe, expect, it } from 'vitest'
import { isNavigationAllowed } from '../../src/main/security/navigationPolicy'

describe('isNavigationAllowed', () => {
  describe('development (devServerOrigin context)', () => {
    const context = { devServerOrigin: 'http://localhost:5173' }

    it('allows navigation to the dev server origin', () => {
      expect(isNavigationAllowed('http://localhost:5173/some-route', context)).toBe(true)
    })

    it('blocks navigation to an external https origin', () => {
      expect(isNavigationAllowed('https://example.com', context)).toBe(false)
    })

    it('blocks navigation to a different local port', () => {
      expect(isNavigationAllowed('http://localhost:9999/', context)).toBe(false)
    })
  })

  describe('production (productionEntryFileUrl context) — restricted to the exact approved file', () => {
    const approvedFile = 'file:///app/out/renderer/index.html'
    const context = { productionEntryFileUrl: approvedFile }

    it('allows the exact approved renderer file (reload)', () => {
      expect(isNavigationAllowed(approvedFile, context)).toBe(true)
    })

    it('allows the same file with a query string', () => {
      expect(isNavigationAllowed(`${approvedFile}?foo=bar`, context)).toBe(true)
    })

    it('allows the same file with a hash (in-app route)', () => {
      expect(isNavigationAllowed(`${approvedFile}#/settings`, context)).toBe(true)
    })

    it('allows the same file with both a query string and a hash', () => {
      expect(isNavigationAllowed(`${approvedFile}?foo=bar#/settings`, context)).toBe(true)
    })

    it('rejects a sibling file in the same directory', () => {
      expect(isNavigationAllowed('file:///app/out/renderer/other.html', context)).toBe(false)
    })

    it('rejects /etc/passwd', () => {
      expect(isNavigationAllowed('file:///etc/passwd', context)).toBe(false)
    })

    it("rejects another user's file path", () => {
      expect(isNavigationAllowed('file:///Users/someone-else/secret.txt', context)).toBe(false)
    })

    it('rejects an unrelated file URL entirely', () => {
      expect(isNavigationAllowed('file:///var/tmp/random-file.html', context)).toBe(false)
    })

    it('rejects a UNC-style file URL with the same pathname but a non-empty hostname', () => {
      expect(isNavigationAllowed('file://evil-host/app/out/renderer/index.html', context)).toBe(
        false
      )
    })

    it('rejects a UNC-style file URL with the same pathname and a genuinely different hostname', () => {
      // Note: file://localhost/... is NOT a useful case here — the WHATWG
      // URL spec normalizes 'localhost' to an empty file-URL hostname, so
      // it is correctly equivalent to file:///.... A real non-'localhost'
      // hostname is needed to exercise the mismatch this patch closes.
      expect(
        isNavigationAllowed('file://some-other-host/app/out/renderer/index.html', context)
      ).toBe(false)
    })

    it('rejects https even though the app is otherwise in production mode', () => {
      expect(isNavigationAllowed('https://example.com', context)).toBe(false)
    })

    it('rejects http', () => {
      expect(isNavigationAllowed('http://localhost:5173', context)).toBe(false)
    })
  })

  describe('production — approved file itself has a non-empty hostname (UNC-style)', () => {
    const approvedFile = 'file://approved-host/app/out/renderer/index.html'
    const context = { productionEntryFileUrl: approvedFile }

    it('allows a target with the exact matching hostname and pathname', () => {
      expect(isNavigationAllowed(approvedFile, context)).toBe(true)
    })

    it('rejects a target with the same pathname but a different hostname', () => {
      expect(
        isNavigationAllowed('file://different-host/app/out/renderer/index.html', context)
      ).toBe(false)
    })

    it('rejects a target with the same pathname and an empty hostname', () => {
      expect(isNavigationAllowed('file:///app/out/renderer/index.html', context)).toBe(false)
    })
  })

  it('denies rather than throws on a malformed target URL', () => {
    expect(
      isNavigationAllowed('not a url', { productionEntryFileUrl: 'file:///app/index.html' })
    ).toBe(false)
  })

  it('denies rather than throws on a malformed approved production URL', () => {
    expect(
      isNavigationAllowed('file:///app/index.html', { productionEntryFileUrl: 'not a url' })
    ).toBe(false)
  })

  it('denies rather than throws on a malformed dev server origin', () => {
    expect(isNavigationAllowed('http://localhost:5173', { devServerOrigin: 'not a url' })).toBe(
      false
    )
  })

  it('denies when no approved context is provided at all', () => {
    expect(isNavigationAllowed('file:///app/index.html', {})).toBe(false)
  })
})

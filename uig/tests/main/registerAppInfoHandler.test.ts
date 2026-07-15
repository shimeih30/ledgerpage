import { beforeEach, describe, expect, it, vi } from 'vitest'

const handle = vi.fn()

vi.mock('electron', () => ({
  app: {
    getName: () => 'LedgerPage',
    getVersion: () => '0.1.0'
  },
  ipcMain: { handle }
}))

const context = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }

describe('registerAppInfoHandler', () => {
  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
  })

  it('registers exactly one handler, on the app-info channel', async () => {
    const { registerAppInfoHandler } = await import('../../src/main/ipc/registerAppInfoHandler')
    const { APP_INFO_CHANNEL } = await import('../../src/shared/ipc/appInfo')

    registerAppInfoHandler(context)

    expect(handle).toHaveBeenCalledTimes(1)
    expect(handle.mock.calls[0][0]).toBe(APP_INFO_CHANNEL)
  })

  it('returns app name, version, and the current platform for an approved sender', async () => {
    const { registerAppInfoHandler } = await import('../../src/main/ipc/registerAppInfoHandler')
    registerAppInfoHandler(context)

    const handler = handle.mock.calls[0][1] as (event: unknown) => unknown
    const approvedEvent = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }

    expect(handler(approvedEvent)).toEqual({
      name: 'LedgerPage',
      version: '0.1.0',
      platform: process.platform
    })
  })

  it('rejects a request from an external https sender', async () => {
    const { registerAppInfoHandler } = await import('../../src/main/ipc/registerAppInfoHandler')
    registerAppInfoHandler(context)

    const handler = handle.mock.calls[0][1] as (event: unknown) => unknown
    const rejectedEvent = { senderFrame: { url: 'https://example.com' } }

    expect(() => handler(rejectedEvent)).toThrow()
  })

  it('rejects a request from an arbitrary file path', async () => {
    const { registerAppInfoHandler } = await import('../../src/main/ipc/registerAppInfoHandler')
    registerAppInfoHandler(context)

    const handler = handle.mock.calls[0][1] as (event: unknown) => unknown
    const rejectedEvent = { senderFrame: { url: 'file:///etc/passwd' } }

    expect(() => handler(rejectedEvent)).toThrow()
  })

  it('rejects a request with no sender frame', async () => {
    const { registerAppInfoHandler } = await import('../../src/main/ipc/registerAppInfoHandler')
    registerAppInfoHandler(context)

    const handler = handle.mock.calls[0][1] as (event: unknown) => unknown
    expect(() => handler({ senderFrame: null })).toThrow()
  })
})

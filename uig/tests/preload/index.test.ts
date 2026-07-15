import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
const invoke = vi
  .fn()
  .mockResolvedValue({ name: 'LedgerPage', version: '0.1.0', platform: 'linux' })

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke }
}))

describe('preload API surface', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
    invoke.mockClear()
  })

  it('exposes exactly one namespace: ledgerpage', async () => {
    await import('../../src/preload/index')

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('ledgerpage')
  })

  it('exposes exactly one method: getAppInfo — no other keys', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api)).toEqual(['getAppInfo'])
  })

  it('getAppInfo invokes exactly the app-info channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { APP_INFO_CHANNEL } = await import('../../src/shared/ipc/appInfo')

    const api = exposeInMainWorld.mock.calls[0][1] as { getAppInfo: () => Promise<unknown> }
    await api.getAppInfo()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(APP_INFO_CHANNEL)
  })
})

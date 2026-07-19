import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
const invoke = vi
  .fn()
  .mockResolvedValue({ name: 'LedgerPage', version: '0.1.0', platform: 'linux' })

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke }
}))

const EXPECTED_KEYS = [
  'getAppInfo',
  'getFirstRunStatus',
  'prepareRecoveryKey',
  'confirmRecoveryKey',
  'cancelRecoveryKey',
  'completeSetup'
]

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

  it('exposes exactly six methods — getAppInfo plus the five Slice 8 setup methods, no others', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual([...EXPECTED_KEYS].sort())
  })

  it('getAppInfo invokes exactly the app-info channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { APP_INFO_CHANNEL } = await import('../../src/shared/ipc/appInfo')

    const api = exposeInMainWorld.mock.calls[0][1] as { getAppInfo: () => Promise<unknown> }
    await api.getAppInfo()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(APP_INFO_CHANNEL)
  })

  it('getFirstRunStatus invokes exactly the setup:get-status channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { SETUP_GET_STATUS_CHANNEL } = await import('../../src/shared/ipc/setup')

    const api = exposeInMainWorld.mock.calls[0][1] as { getFirstRunStatus: () => Promise<unknown> }
    await api.getFirstRunStatus()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(SETUP_GET_STATUS_CHANNEL)
  })

  it('prepareRecoveryKey invokes exactly the setup:prepare-recovery-key channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { SETUP_PREPARE_RECOVERY_KEY_CHANNEL } = await import('../../src/shared/ipc/setup')

    const api = exposeInMainWorld.mock.calls[0][1] as { prepareRecoveryKey: () => Promise<unknown> }
    await api.prepareRecoveryKey()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(SETUP_PREPARE_RECOVERY_KEY_CHANNEL)
  })

  it('confirmRecoveryKey forwards its input to the setup:confirm-recovery-key channel unchanged', async () => {
    await import('../../src/preload/index')
    const { SETUP_CONFIRM_RECOVERY_KEY_CHANNEL } = await import('../../src/shared/ipc/setup')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      confirmRecoveryKey: (input: unknown) => Promise<unknown>
    }
    const input = { ceremonyToken: 'tok', reenteredKey: 'key' }
    await api.confirmRecoveryKey(input)

    expect(invoke).toHaveBeenCalledWith(SETUP_CONFIRM_RECOVERY_KEY_CHANNEL, input)
  })

  it('cancelRecoveryKey forwards its input to the setup:cancel-recovery-key channel unchanged', async () => {
    await import('../../src/preload/index')
    const { SETUP_CANCEL_RECOVERY_KEY_CHANNEL } = await import('../../src/shared/ipc/setup')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      cancelRecoveryKey: (input: unknown) => Promise<unknown>
    }
    const input = { ceremonyToken: 'tok' }
    await api.cancelRecoveryKey(input)

    expect(invoke).toHaveBeenCalledWith(SETUP_CANCEL_RECOVERY_KEY_CHANNEL, input)
  })

  it('completeSetup forwards its input to the setup:complete channel unchanged', async () => {
    await import('../../src/preload/index')
    const { SETUP_COMPLETE_CHANNEL } = await import('../../src/shared/ipc/setup')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      completeSetup: (input: unknown) => Promise<unknown>
    }
    const input = {
      company: { name: 'X', address: 'Y', contactDetails: 'Z' },
      owner: { displayName: 'A', loginIdentifier: 'b', password: 'c', passwordConfirmation: 'c' },
      commitToken: 'tok'
    }
    await api.completeSetup(input)

    expect(invoke).toHaveBeenCalledWith(SETUP_COMPLETE_CHANNEL, input)
  })
})

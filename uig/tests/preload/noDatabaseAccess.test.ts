import { beforeEach, describe, expect, it, vi } from 'vitest'

const exposeInMainWorld = vi.fn()
const invoke = vi
  .fn()
  .mockResolvedValue({ name: 'LedgerPage', version: '0.1.0', platform: 'linux' })

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke }
}))

/**
 * Slice 3 adds SQLite, migrations, and filesystem access to the main
 * process. This test exists to make explicit — not just implicit via the
 * key-list assertion in tests/preload/index.test.ts — that none of that
 * reaches the renderer. Per the approved architecture, database and
 * filesystem access must never be exposed through preload or IPC.
 */
describe('preload API surface after Slice 3', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any database, SQL, or filesystem method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of ['db', 'database', 'sql', 'query', 'fs', 'file', 'path', 'migrate']) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the Slice 2 app-info API — nothing added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api)).toEqual(['getAppInfo'])
  })
})

/**
 * Slice 4 adds reference-data tables and a seeding service. This test
 * exists to make explicit that none of that reaches the renderer either —
 * no currency/unit/payment-method/expense-category read or write API of
 * any kind.
 */
describe('preload API surface after Slice 4', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any reference-data method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'currency',
      'currencies',
      'unit',
      'uom',
      'payment',
      'expense',
      'category',
      'reference'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the Slice 2 app-info API after Slice 4 — nothing added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api)).toEqual(['getAppInfo'])
  })
})

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

  it('still exposes exactly the approved app-info + Slice 8 setup API — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
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

  it('still exposes exactly the approved app-info + Slice 8 setup API after Slice 4 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
  })
})

/**
 * Slice 5 adds the company profile and document-numbering tables and
 * services. This test exists to make explicit that none of that reaches
 * the renderer either — no company read/write API, no numbering
 * allocation API, no arbitrary SQL IPC of any kind.
 */
describe('preload API surface after Slice 5', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any company or numbering method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'company',
      'numbering',
      'sequence',
      'allocate',
      'invoice',
      'quotation',
      'order'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the approved app-info + Slice 8 setup API after Slice 5 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
  })
})

/**
 * Slice 6 adds tax configuration (tax_codes, tax_rate_versions) and
 * three services (taxCodeService, taxRateVersionService,
 * taxRateResolutionService). This test exists to make explicit that
 * none of that reaches the renderer either.
 */
describe('preload API surface after Slice 6', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any tax method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of ['tax', 'vat', 'rate', 'ppm', 'resolve']) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the approved app-info + Slice 8 setup API after Slice 6 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
  })
})

/**
 * Slice 7 adds authentication and authorization (users, roles,
 * user_roles, owner_recovery_credentials, login_events, plus password
 * hashing, sessions, and the recovery ceremony). This test originally
 * asserted no authentication-adjacent method of any kind reached the
 * renderer — accurate at the time, since no UI/IPC existed yet. Slice
 * 8 intentionally and narrowly changes that (first-run status, the
 * five setup:* methods), so the forbidden list below now targets
 * specific dangerous patterns (a raw login/session/password API, not
 * the narrow, approved first-run setup surface) rather than broad
 * substrings like "recovery" or "user" that Slice 8's approved method
 * names legitimately contain.
 */
describe('preload API surface after Slice 7', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose a general login, session, or password-handling method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'login',
      'logout',
      'signin',
      'signout',
      'authenticate',
      'passwordhash',
      'session',
      'unlock',
      'permission',
      'manageuser',
      'listuser',
      'deleteuser',
      'assignrole',
      'grantrole'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the approved app-info + Slice 8 setup API after Slice 7 -- nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
  })
})

/**
 * Slice 8 adds real authentication/setup capability to the main
 * process for the first time. This test exists to make explicit that
 * none of the specific things the setup flow works with — a database
 * handle, a password hash, a recovery hash, role mutation, general
 * user-management, or raw session mutation — are exposed through
 * preload, beyond the five narrow setup:* methods.
 */
describe('preload API surface after Slice 8', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose a database handle, password hash, recovery hash, role mutation, user-management, or session API', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'db',
      'database',
      'sql',
      'query',
      'fs',
      'file',
      'path',
      'migrate',
      'passwordhash',
      'recoveryhash',
      'role',
      'manageuser',
      'listuser',
      'deleteuser',
      'session',
      'unlock'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('exposes exactly the approved app-info + five setup methods — nothing else', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup'
      ].sort()
    )
  })
})

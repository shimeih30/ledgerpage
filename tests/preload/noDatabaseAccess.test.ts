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

  it('still exposes exactly the approved app-info + Slice 8/9/10/11 API — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })
})

/**
 * Slice 4 adds reference-data tables and a seeding service. This test
 * exists to make explicit that none of that reaches the renderer either —
 * no currency/unit/payment-method/expense-category read or write API of
 * any kind — except for one narrow, deliberate exception introduced by
 * Slice 12: listAssignableUnitsOfMeasure, a read-only lookup of {id,
 * code, name, category} for active units of measure only, needed for
 * the inventory item form's unit-of-measure dropdown (Slice 4 itself
 * shipped no reference-data UI/IPC surface at all). This is not a
 * general reference-data management API — no create/update/deactivate/
 * reactivate method is exposed for units of measure or any other
 * reference-data table, and no decimal-places or sort-order internal is
 * ever included in its result.
 */
describe('preload API surface after Slice 4', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any reference-data method to the renderer, other than the one narrow, justified Slice 12 exception', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api)
      .filter((key) => key !== 'listAssignableUnitsOfMeasure')
      .map((key) => key.toLowerCase())

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

  it('still exposes exactly the approved app-info + Slice 8/9 API after Slice 4 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
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

  it('still exposes exactly the approved app-info + Slice 8/9 API after Slice 5 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })
})

/**
 * Slice 6 adds tax configuration (tax_codes, tax_rate_versions) and
 * three services (taxCodeService, taxRateVersionService,
 * taxRateResolutionService). This test exists to make explicit that
 * none of that reaches the renderer either -- except for one narrow,
 * deliberate exception introduced by Slice 11: listAssignableTaxCodes,
 * a read-only lookup of {id, code, name} for active tax codes only,
 * needed for the product variant form's tax-code dropdown (Slice 6
 * itself shipped no tax UI/IPC surface at all). This is not a general
 * tax-management API — no create/update/deactivate/reactivate/rate-
 * resolution method is exposed, and no inactive tax code or rate detail
 * is ever included in its result.
 */
describe('preload API surface after Slice 6', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any tax method to the renderer, other than the one narrow, justified Slice 11 exception', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api)
      .filter((key) => key !== 'listAssignableTaxCodes')
      .map((key) => key.toLowerCase())

    for (const forbidden of ['tax', 'vatregist', 'rate', 'ppm', 'resolve']) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the approved app-info + Slice 8/9 API after Slice 6 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
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
 * 8 intentionally and narrowly changed that (first-run status, the
 * five setup:* methods), and Slice 9 further adds the actual
 * login/lock/logout/user-management surface. The forbidden list below
 * now targets patterns that remain genuinely dangerous regardless (a
 * raw password hash, sign-in/out aliases distinct from the approved
 * "login" name, a general permission-grant API, deleting a user
 * outright rather than deactivating one, directly assigning/granting a
 * role bypassing userManagementService's own fixed create-time flow)
 * rather than broad substrings like "login"/"session"/"unlock" that
 * Slice 9's approved method names now legitimately contain.
 */
describe('preload API surface after Slice 7', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose a raw password hash, sign-in alias, permission grant, or user-deletion method to the renderer', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'signin',
      'signout',
      'authenticate',
      'passwordhash',
      'permission',
      'manageuser',
      'deleteuser',
      'assignrole',
      'grantrole'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('still exposes exactly the approved app-info + Slice 8/9 API after Slice 7 -- nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })
})

/**
 * Slice 8 added real authentication/setup capability to the main
 * process for the first time; Slice 9 adds the actual login/session
 * and Owner-gated user-management surface on top. This test exists to
 * make explicit that the things genuinely still absent — a raw
 * database handle, arbitrary SQL/filesystem access, a password hash,
 * a recovery hash, deleting a user outright, or directly
 * assigning/granting a role bypassing the fixed create-time flow —
 * are still absent, without re-forbidding the broad substrings
 * ("role", "session", "unlock", "listuser") that Slice 9's approved
 * method names now legitimately contain.
 */
describe('preload API surface after Slice 8', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose a database handle, arbitrary SQL/filesystem access, a password/recovery hash, user deletion, or direct role assignment', async () => {
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
      'manageuser',
      'deleteuser',
      'assignrole',
      'grantrole'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('exposes exactly the approved app-info + Slice 8/9 API after Slice 8 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })
})

/**
 * Slice 9 adds the actual login/lock/logout flow and an Owner-only
 * user-management surface. This test exists to make explicit that the
 * things this slice specifically must never expose — a raw session id
 * (no channel accepts or returns one; every operation implicitly
 * targets "the current session," which only the main process tracks),
 * a way to change an existing user's role or grant/revoke the Owner
 * role, a way to delete a user outright rather than deactivate one,
 * and arbitrary SQL — are still absent, beyond the ten narrow
 * login/session/users/roles methods.
 */
describe('preload API surface after Slice 9', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose a raw session id, role-change, user-deletion, or arbitrary-SQL method', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'sessionid',
      'setrole',
      'changerole',
      'updaterole',
      'grantowner',
      'setowner',
      'makeowner',
      'deleteuser',
      'rawsql',
      'exec',
      'passwordhash',
      'recoveryhash'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('exposes exactly the approved app-info + Slice 8/9 API after Slice 9 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })
})

/**
 * Slice 10 adds the one read-only audit:list channel. This test exists
 * to make explicit that the things this slice specifically must never
 * expose — any audit mutation method (record/update/delete an audit
 * entry), arbitrary SQL, or a raw database handle — are still absent,
 * beyond the eleven narrow login/session/users/roles/audit methods.
 */
describe('preload API surface after Slice 10', () => {
  beforeEach(() => {
    vi.resetModules()
    exposeInMainWorld.mockClear()
  })

  it('does not expose any audit mutation method or arbitrary-SQL/database-handle access', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api).map((key) => key.toLowerCase())

    for (const forbidden of [
      'recordaudit',
      'createaudit',
      'updateaudit',
      'deleteaudit',
      'removeaudit',
      'auditwrite',
      'auditmutate',
      'rawsql',
      'exec',
      'database',
      'sessionid'
    ]) {
      expect(exposedKeys.some((key) => key.includes(forbidden))).toBe(false)
    }
  })

  it('exposes exactly the approved app-info + Slice 8/9/10 API after Slice 10 — nothing unapproved added', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(api).sort()).toEqual(
      [
        'getAppInfo',
        'getFirstRunStatus',
        'prepareRecoveryKey',
        'confirmRecoveryKey',
        'cancelRecoveryKey',
        'completeSetup',
        'login',
        'getSessionState',
        'unlockSession',
        'logout',
        'touchSession',
        'listUsers',
        'createUser',
        'deactivateUser',
        'reactivateUser',
        'listAssignableRoles',
        'listAuditEntries',
        'listProducts',
        'getProduct',
        'createProduct',
        'updateProduct',
        'deactivateProduct',
        'reactivateProduct',
        'listVariantsForProduct',
        'getVariant',
        'createVariant',
        'updateVariant',
        'deactivateVariant',
        'reactivateVariant',
        'listAssignableTaxCodes',
        'listInventoryItems',
        'getInventoryItem',
        'createInventoryItem',
        'updateInventoryItem',
        'deactivateInventoryItem',
        'reactivateInventoryItem',
        'listAssignableUnitsOfMeasure',
        'listSuppliers',
        'getSupplier',
        'createSupplier',
        'updateSupplier',
        'deactivateSupplier',
        'reactivateSupplier',
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice',
        'listCustomers',
        'getCustomer',
        'createCustomer',
        'updateCustomer',
        'deactivateCustomer',
        'reactivateCustomer',
        'listContactsForCustomer',
        'getCustomerContact',
        'createCustomerContact',
        'updateCustomerContact',
        'deactivateCustomerContact',
        'reactivateCustomerContact',
        'listInventoryLotsForItem',
        'getInventoryLot',
        'listInventoryLotMovements',
        'listStockSummaries',
        'getStockSummary',
        'listAccounts',
        'getAccount',
        'createAccount',
        'updateAccount',
        'deactivateAccount',
        'reactivateAccount',
        'listJournalEntries',
        'getJournalEntry',
        'createJournalEntry',
        'reverseJournalEntry',
        'getTrialBalance'
      ].sort()
    )
  })

  /**
   * Slice 13's supplier_item_prices table is append-only by design:
   * insert, list, and current-price lookup only. This test exists to
   * make that guarantee explicit at the preload layer specifically --
   * no exposed method name anywhere in the API suggests an update,
   * delete, edit, or removal operation on a price row. The service- and
   * IPC-layer halves of this same guarantee are covered directly in
   * registerSupplierHandlers.test.ts.
   */
  it('exposes no method that could update or delete a supplier price row', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const priceRelatedKeys = Object.keys(api).filter((key) => /price/i.test(key))

    expect(priceRelatedKeys.sort()).toEqual(
      [
        'recordSupplierPrice',
        'listPricesForSupplier',
        'listPricesForInventoryItem',
        'getCurrentSupplierItemPrice'
      ].sort()
    )
    for (const key of priceRelatedKeys) {
      expect(key).not.toMatch(/update|delete|edit|remove|deactivate|reactivate/i)
    }
  })

  /**
   * Slice 14's customer_contacts table uses soft activation only, the
   * same append-only-style guarantee as Slice 13's supplier prices,
   * just with an update path (unlike prices) rather than none at all.
   * No exposed method name anywhere in the API suggests a hard delete
   * or removal of a contact, and no customer method allows selecting or
   * mutating a currency -- currencyId is always FUNCTIONAL_CURRENCY_ID,
   * assigned server-side.
   */
  it('exposes no method that could hard-delete a customer contact, and no customer currency-selection or currency-mutation method', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api)

    expect(exposedKeys).not.toContain('deleteCustomerContact')
    expect(exposedKeys).not.toContain('removeCustomerContact')
    expect(exposedKeys).not.toContain('deleteCustomer')
    expect(exposedKeys).not.toContain('removeCustomer')

    const contactRelatedKeys = exposedKeys.filter((key) => /contact/i.test(key))
    for (const key of contactRelatedKeys) {
      expect(key).not.toMatch(/delete|remove/i)
    }

    const customerRelatedKeys = exposedKeys.filter((key) => /customer/i.test(key))
    for (const key of customerRelatedKeys) {
      expect(key.toLowerCase()).not.toContain('currency')
    }
  })

  /**
   * Slice 15's own IPC surface is entirely read-only -- the approved
   * architecture is "read-only stock renderer and IPC". No exposed
   * method name anywhere in the API suggests any stock mutation:
   * createOpeningLot, recordReceipt, recordAdjustment, reserveStock,
   * releaseReservation, reverseMovement, consumeStock,
   * setLotQuarantined, and setLotActive all remain internal-only,
   * callable in-process by later slices, never exposed over IPC in
   * this slice -- and no update/delete surface exists for either lots
   * or movements.
   */
  it('exposes no stock/inventory-lot mutation method of any kind', async () => {
    await import('../../src/preload/index')

    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api)

    const explicitlyProhibited = [
      'createOpeningLot',
      'recordReceipt',
      'recordAdjustment',
      'reserveStock',
      'releaseReservation',
      'reverseMovement',
      'consumeStock',
      'setLotQuarantined',
      'setLotActive',
      'updateInventoryLot',
      'deleteInventoryLot',
      'updateStockMovement',
      'deleteStockMovement',
      'createStock',
      'updateStock',
      'deleteStock',
      'adjustStock',
      'mutateStock'
    ]
    for (const prohibited of explicitlyProhibited) {
      expect(exposedKeys).not.toContain(prohibited)
    }

    // Every one of the 5 approved read-only methods must still be
    // present -- confirming the check above isn't accidentally
    // over-broad and silently passing because nothing stock-related
    // was exposed at all.
    const approvedReadOnly = [
      'listInventoryLotsForItem',
      'getInventoryLot',
      'listInventoryLotMovements',
      'listStockSummaries',
      'getStockSummary'
    ]
    for (const approved of approvedReadOnly) {
      expect(exposedKeys).toContain(approved)
    }

    // A broader, name-pattern sweep across every stock/lot-related key:
    // none may look like a mutation, regardless of exact naming.
    const stockRelatedKeys = exposedKeys.filter((key) => /stock|inventorylot/i.test(key))
    for (const key of stockRelatedKeys) {
      expect(key).not.toMatch(
        /create|record|reserve|release|reverse|consume|quarantine|activate|update|delete|adjust|mutate/i
      )
    }
    expect(stockRelatedKeys.sort()).toEqual(approvedReadOnly.sort())
  })

  it('exposes no accounting mutation method of any kind beyond the 11 approved accounting methods', async () => {
    await import('../../src/preload/index')
    const api = exposeInMainWorld.mock.calls[0][1] as Record<string, unknown>
    const exposedKeys = Object.keys(api)

    const explicitlyProhibited = [
      'deleteAccount',
      'removeAccount',
      'updateJournalEntry',
      'deleteJournalEntry',
      'removeJournalEntry',
      'updateJournalEntryLine',
      'deleteJournalEntryLine',
      'removeJournalEntryLine',
      'postOperationalEntry',
      'automaticPosting',
      'createDraftJournalEntry',
      'approveJournalEntry',
      'unlockPeriod',
      'closeAccountingPeriod',
      'selectJournalCurrency'
    ]
    for (const prohibited of explicitlyProhibited) {
      expect(exposedKeys).not.toContain(prohibited)
    }

    // Every one of the 11 approved accounting methods must still be
    // present -- confirming the check above isn't accidentally
    // over-broad and silently passing because nothing accounting-
    // related was exposed at all.
    const approvedAccounting = [
      'listAccounts',
      'getAccount',
      'createAccount',
      'updateAccount',
      'deactivateAccount',
      'reactivateAccount',
      'listJournalEntries',
      'getJournalEntry',
      'createJournalEntry',
      'reverseJournalEntry',
      'getTrialBalance'
    ]
    for (const approved of approvedAccounting) {
      expect(exposedKeys).toContain(approved)
    }

    // A broader, name-pattern sweep across every account/journal-related
    // key: none may look like an update/delete/draft/approval/period/
    // currency-selection or automatic-posting control, regardless of
    // exact naming.
    const accountingRelatedKeys = exposedKeys.filter((key) =>
      /account|journal|trialbalance/i.test(key)
    )
    for (const key of accountingRelatedKeys) {
      expect(key).not.toMatch(
        /delete|remove|updatejournal|automatic|operational|draft|approve|unlock|close|selectcurrency/i
      )
    }
    expect(accountingRelatedKeys.sort()).toEqual(approvedAccounting.sort())
  })
})

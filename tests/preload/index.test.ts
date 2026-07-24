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
  'listAssignableUnitsOfMeasure'
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

  it('exposes exactly getAppInfo plus the Slice 8 setup, Slice 9 login/users, Slice 10 audit, and Slice 11 products methods, no others', async () => {
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

  it('login forwards its input to the login:attempt channel unchanged', async () => {
    await import('../../src/preload/index')
    const { LOGIN_ATTEMPT_CHANNEL } = await import('../../src/shared/ipc/login')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      login: (input: unknown) => Promise<unknown>
    }
    const input = { loginIdentifier: 'ben', password: 'secret' }
    await api.login(input)

    expect(invoke).toHaveBeenCalledWith(LOGIN_ATTEMPT_CHANNEL, input)
  })

  it('getSessionState invokes exactly the login:get-session-state channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { LOGIN_GET_SESSION_STATE_CHANNEL } = await import('../../src/shared/ipc/login')

    const api = exposeInMainWorld.mock.calls[0][1] as { getSessionState: () => Promise<unknown> }
    await api.getSessionState()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(LOGIN_GET_SESSION_STATE_CHANNEL)
  })

  it('unlockSession forwards its input to the login:unlock channel unchanged', async () => {
    await import('../../src/preload/index')
    const { LOGIN_UNLOCK_CHANNEL } = await import('../../src/shared/ipc/login')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      unlockSession: (input: unknown) => Promise<unknown>
    }
    const input = { password: 'secret' }
    await api.unlockSession(input)

    expect(invoke).toHaveBeenCalledWith(LOGIN_UNLOCK_CHANNEL, input)
  })

  it('logout invokes exactly the login:logout channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { LOGIN_LOGOUT_CHANNEL } = await import('../../src/shared/ipc/login')

    const api = exposeInMainWorld.mock.calls[0][1] as { logout: () => Promise<unknown> }
    await api.logout()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(LOGIN_LOGOUT_CHANNEL)
  })

  it('touchSession invokes exactly the login:touch channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { LOGIN_TOUCH_CHANNEL } = await import('../../src/shared/ipc/login')

    const api = exposeInMainWorld.mock.calls[0][1] as { touchSession: () => Promise<unknown> }
    await api.touchSession()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(LOGIN_TOUCH_CHANNEL)
  })

  it('listUsers invokes exactly the users:list channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { USERS_LIST_CHANNEL } = await import('../../src/shared/ipc/users')

    const api = exposeInMainWorld.mock.calls[0][1] as { listUsers: () => Promise<unknown> }
    await api.listUsers()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(USERS_LIST_CHANNEL)
  })

  it('createUser forwards its input to the users:create channel unchanged', async () => {
    await import('../../src/preload/index')
    const { USERS_CREATE_CHANNEL } = await import('../../src/shared/ipc/users')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      createUser: (input: unknown) => Promise<unknown>
    }
    const input = {
      displayName: 'A',
      loginIdentifier: 'a',
      password: 'p',
      passwordConfirmation: 'p',
      roleCode: 'finance'
    }
    await api.createUser(input)

    expect(invoke).toHaveBeenCalledWith(USERS_CREATE_CHANNEL, input)
  })

  it('deactivateUser forwards its input to the users:deactivate channel unchanged', async () => {
    await import('../../src/preload/index')
    const { USERS_DEACTIVATE_CHANNEL } = await import('../../src/shared/ipc/users')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      deactivateUser: (input: unknown) => Promise<unknown>
    }
    const input = { userId: 'user_1' }
    await api.deactivateUser(input)

    expect(invoke).toHaveBeenCalledWith(USERS_DEACTIVATE_CHANNEL, input)
  })

  it('reactivateUser forwards its input to the users:reactivate channel unchanged', async () => {
    await import('../../src/preload/index')
    const { USERS_REACTIVATE_CHANNEL } = await import('../../src/shared/ipc/users')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      reactivateUser: (input: unknown) => Promise<unknown>
    }
    const input = { userId: 'user_1' }
    await api.reactivateUser(input)

    expect(invoke).toHaveBeenCalledWith(USERS_REACTIVATE_CHANNEL, input)
  })

  it('listAssignableRoles invokes exactly the roles:list-assignable channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { ROLES_LIST_ASSIGNABLE_CHANNEL } = await import('../../src/shared/ipc/users')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      listAssignableRoles: () => Promise<unknown>
    }
    await api.listAssignableRoles()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(ROLES_LIST_ASSIGNABLE_CHANNEL)
  })

  it('listAuditEntries forwards its input to the audit:list channel unchanged', async () => {
    await import('../../src/preload/index')
    const { AUDIT_LIST_CHANNEL } = await import('../../src/shared/ipc/audit')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      listAuditEntries: (input: unknown) => Promise<unknown>
    }
    const input = { entityType: 'user', limit: 25 }
    await api.listAuditEntries(input)

    expect(invoke).toHaveBeenCalledWith(AUDIT_LIST_CHANNEL, input)
  })

  it('listProducts invokes exactly the products:list channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { PRODUCTS_LIST_CHANNEL } = await import('../../src/shared/ipc/products')

    const api = exposeInMainWorld.mock.calls[0][1] as { listProducts: () => Promise<unknown> }
    await api.listProducts()

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(PRODUCTS_LIST_CHANNEL)
  })

  it('createProduct forwards its input to the products:create channel unchanged', async () => {
    await import('../../src/preload/index')
    const { PRODUCTS_CREATE_CHANNEL } = await import('../../src/shared/ipc/products')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      createProduct: (input: unknown) => Promise<unknown>
    }
    const input = { name: 'Jam', type: 'manufactured' }
    await api.createProduct(input)

    expect(invoke).toHaveBeenCalledWith(PRODUCTS_CREATE_CHANNEL, input)
  })

  it('createVariant forwards its input to the product-variants:create channel unchanged -- structurally never a currencyId, actor, or session field, since CreateVariantInput has no such properties', async () => {
    await import('../../src/preload/index')
    const { PRODUCT_VARIANTS_CREATE_CHANNEL } = await import('../../src/shared/ipc/products')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      createVariant: (input: unknown) => Promise<unknown>
    }
    const input = { productId: 'product_1', code: 'A', name: 'A', sellingPriceMinor: 500 }
    await api.createVariant(input)

    expect(invoke).toHaveBeenCalledWith(PRODUCT_VARIANTS_CREATE_CHANNEL, input)
  })

  it('deactivateVariant forwards its input to the product-variants:deactivate channel unchanged', async () => {
    await import('../../src/preload/index')
    const { PRODUCT_VARIANTS_DEACTIVATE_CHANNEL } = await import('../../src/shared/ipc/products')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      deactivateVariant: (input: unknown) => Promise<unknown>
    }
    const input = { variantId: 'variant_1' }
    await api.deactivateVariant(input)

    expect(invoke).toHaveBeenCalledWith(PRODUCT_VARIANTS_DEACTIVATE_CHANNEL, input)
  })

  it('listInventoryItems invokes exactly the inventory-items:list channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { INVENTORY_ITEMS_LIST_CHANNEL } = await import('../../src/shared/ipc/inventoryItems')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      listInventoryItems: () => Promise<unknown>
    }
    await api.listInventoryItems()

    expect(invoke).toHaveBeenCalledWith(INVENTORY_ITEMS_LIST_CHANNEL)
  })

  it('createInventoryItem forwards its input to the inventory-items:create channel unchanged', async () => {
    await import('../../src/preload/index')
    const { INVENTORY_ITEMS_CREATE_CHANNEL } = await import('../../src/shared/ipc/inventoryItems')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      createInventoryItem: (input: unknown) => Promise<unknown>
    }
    const input = {
      code: 'FLOUR',
      name: 'Flour',
      category: 'Dry goods',
      itemType: 'ingredient',
      unitOfMeasureId: 'uom_kg',
      minimumStock: 10,
      reorderQuantity: 20,
      leadTimeDays: 3
    }
    await api.createInventoryItem(input)

    expect(invoke).toHaveBeenCalledWith(INVENTORY_ITEMS_CREATE_CHANNEL, input)
  })

  it('updateInventoryItem forwards its input to the inventory-items:update channel unchanged -- structurally never a code or itemType field, since UpdateInventoryItemInput has no such properties', async () => {
    await import('../../src/preload/index')
    const { INVENTORY_ITEMS_UPDATE_CHANNEL } = await import('../../src/shared/ipc/inventoryItems')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      updateInventoryItem: (input: unknown) => Promise<unknown>
    }
    const input = { inventoryItemId: 'inventory_item_1', name: 'New name' }
    await api.updateInventoryItem(input)

    expect(invoke).toHaveBeenCalledWith(INVENTORY_ITEMS_UPDATE_CHANNEL, input)
  })

  it('listAssignableUnitsOfMeasure invokes exactly the inventory-items:list-assignable-units channel, with no arguments', async () => {
    await import('../../src/preload/index')
    const { INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL } =
      await import('../../src/shared/ipc/inventoryItems')

    const api = exposeInMainWorld.mock.calls[0][1] as {
      listAssignableUnitsOfMeasure: () => Promise<unknown>
    }
    await api.listAssignableUnitsOfMeasure()

    expect(invoke).toHaveBeenCalledWith(INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL)
  })
})

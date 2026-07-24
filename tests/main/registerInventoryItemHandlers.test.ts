import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { createUser, deactivateUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { unitsOfMeasure, userRoles } from '../../src/main/db/schema'
import type { AppDb } from '../../src/main/db/dbTypes'
import type { LoginService } from '../../src/main/users/loginService'
import { createTempDir, removeTempDir } from '../helpers/tempDir'

const handle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle }
}))

const context = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }
const APPROVED_EVENT = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }
const UNAPPROVED_EVENT = { senderFrame: { url: 'https://evil.example.com' } }

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

const EXPECTED_CHANNELS = [
  'inventory-items:list',
  'inventory-items:get',
  'inventory-items:create',
  'inventory-items:update',
  'inventory-items:deactivate',
  'inventory-items:reactivate',
  'inventory-items:list-assignable-units'
]

const VALID_CREATE_INPUT = {
  code: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  itemType: 'ingredient',
  unitOfMeasureId: 'uom_kg',
  minimumStock: 10,
  reorderQuantity: 20,
  leadTimeDays: 3
}

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerInventoryItemHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-inventory-item-handlers')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(
      db,
      {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'c@example.com',
        currencyId: 'currency_usd'
      },
      new Date()
    )
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  async function createUserWithRole(loginIdentifier: string, roleId: string): Promise<string> {
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const user = db.transaction((tx) =>
      createUser(tx, { loginIdentifier, displayName: loginIdentifier, passwordHash })
    )
    db.insert(userRoles).values({ userId: user.id, roleId, createdAt: new Date() }).run()
    return user.id
  }

  function deactivateUnit(unitId: string): void {
    db.update(unitsOfMeasure).set({ isActive: false }).where(eq(unitsOfMeasure.id, unitId)).run()
  }

  async function registerAndCapture(loggedInAs: string | null): Promise<{
    handlers: Record<string, Handler>
    channels: string[]
    loginService: LoginService
  }> {
    const { registerInventoryItemHandlers } =
      await import('../../src/main/ipc/registerInventoryItemHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerInventoryItemHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function createItem(
    handlers: Record<string, Handler>,
    overrides: Partial<typeof VALID_CREATE_INPUT> = {}
  ): { id: string; code: string } {
    const result = handlers['inventory-items:create'](APPROVED_EVENT, {
      ...VALID_CREATE_INPUT,
      ...overrides
    }) as { success: true; inventoryItem: { id: string; code: string } }
    return result.inventoryItem
  }

  it('registers exactly the 7 expected inventory-items channels -- no other mutation channel', async () => {
    await createUserWithRole('owner', 'role_owner')
    const { channels } = await registerAndCapture('owner')
    expect(channels.sort()).toEqual([...EXPECTED_CHANNELS].sort())
  })

  it('rejects an unapproved sender on every channel', async () => {
    await createUserWithRole('owner', 'role_owner')
    const { handlers } = await registerAndCapture('owner')
    for (const channel of EXPECTED_CHANNELS) {
      expect(() => handlers[channel](UNAPPROVED_EVENT, {})).toThrow()
    }
  })

  describe('authorization -- fresh SQLite roles', () => {
    it('an active Owner can read and manage', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        (handlers['inventory-items:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)
      const created = createItem(handlers)
      expect(created.code).toBe('FLOUR')
    })

    it('an active Executive can read and manage', async () => {
      await createUserWithRole('exec1', 'role_executive')
      const { handlers } = await registerAndCapture('exec1')
      expect(
        (handlers['inventory-items:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)
      const created = createItem(handlers)
      expect(created.code).toBe('FLOUR')
    })

    it('an active Operations user can read and manage', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      expect(
        (handlers['inventory-items:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)
      const created = createItem(handlers)
      expect(created.code).toBe('FLOUR')
    })

    it('an active Finance user can read but cannot manage', async () => {
      await createUserWithRole('fin1', 'role_finance')
      const { handlers } = await registerAndCapture('fin1')
      expect(
        (handlers['inventory-items:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)
      const result = handlers['inventory-items:create'](APPROVED_EVENT, VALID_CREATE_INPUT)
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('a Finance user is rejected from every mutation channel', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers: ownerHandlers } = await registerAndCapture('owner')
      const item = createItem(ownerHandlers)

      await createUserWithRole('fin2', 'role_finance')
      const { handlers } = await registerAndCapture('fin2')
      expect(
        handlers['inventory-items:create'](APPROVED_EVENT, {
          ...VALID_CREATE_INPUT,
          code: 'OTHER'
        })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(
        handlers['inventory-items:update'](APPROVED_EVENT, {
          inventoryItemId: item.id,
          name: 'X'
        })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(
        handlers['inventory-items:deactivate'](APPROVED_EVENT, { inventoryItemId: item.id })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
      expect(
        handlers['inventory-items:reactivate'](APPROVED_EVENT, { inventoryItemId: item.id })
      ).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('a logged-out caller is rejected as session_invalid on both read and manage channels', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['inventory-items:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(handlers['inventory-items:create'](APPROVED_EVENT, VALID_CREATE_INPUT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('a locked session is rejected as session_invalid', async () => {
      await createUserWithRole('owner2', 'role_owner')
      const { handlers, loginService } = await registerAndCapture('owner2')
      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      expect(handlers['inventory-items:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session is rejected as session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['inventory-items:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      const userId = await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect(
        (handlers['inventory-items:list'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)

      db.delete(userRoles).run()
      db.insert(userRoles).values({ userId, roleId: 'role_finance', createdAt: new Date() }).run()

      const result = handlers['inventory-items:create'](APPROVED_EVENT, VALID_CREATE_INPUT)
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })

  describe('input validation', () => {
    it('rejects a non-object createInventoryItem input as invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-items:create'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createInventoryItem input missing required fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-items:create'](APPROVED_EVENT, { name: 'X' })).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a non-number minimumStock', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['inventory-items:create'](APPROVED_EVENT, {
          ...VALID_CREATE_INPUT,
          minimumStock: '10'
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a non-boolean lotTracked', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['inventory-items:create'](APPROVED_EVENT, {
          ...VALID_CREATE_INPUT,
          lotTracked: 'yes'
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects an inventoryItemId input that is not an object', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-items:get'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects an out-of-range itemType value as invalid_input via the service-layer check', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['inventory-items:create'](APPROVED_EVENT, {
          ...VALID_CREATE_INPUT,
          itemType: 'not-a-type'
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })
  })

  describe('duplicate/validation error mapping', () => {
    it('maps a duplicate normalized code to duplicate_code', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      createItem(handlers, { code: 'FLOUR' })
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        code: 'flour'
      })
      expect(result).toEqual({ success: false, errorCode: 'duplicate_code' })
    })

    it('maps a nonexistent unit id to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        unitOfMeasureId: 'does-not-exist'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps an inactive unit assignment at creation to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      deactivateUnit('uom_kg')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, VALID_CREATE_INPUT)
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps switching to an inactive unit on update to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const item = createItem(handlers)
      deactivateUnit('uom_l')
      const result = handlers['inventory-items:update'](APPROVED_EVENT, {
        inventoryItemId: item.id,
        unitOfMeasureId: 'uom_l'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('allows an unrelated update to preserve an already-inactive unit unchanged', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const item = createItem(handlers)
      deactivateUnit('uom_kg')
      const result = handlers['inventory-items:update'](APPROVED_EVENT, {
        inventoryItemId: item.id,
        name: 'Renamed'
      }) as { success: true; inventoryItem: { unitOfMeasureId: string; name: string } }
      expect(result.success).toBe(true)
      expect(result.inventoryItem.unitOfMeasureId).toBe('uom_kg')
      expect(result.inventoryItem.name).toBe('Renamed')
    })

    it('maps a negative minimumStock to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        minimumStock: -1
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps a decimal quantity to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        reorderQuantity: 1.5
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps maximumStock below minimumStock to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        minimumStock: 50,
        maximumStock: 10
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('accepts an explicit null maximumStock', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        maximumStock: null
      }) as { success: true; inventoryItem: { maximumStock: number | null } }
      expect(result.success).toBe(true)
      expect(result.inventoryItem.maximumStock).toBeNull()
    })

    it('maps a request against a nonexistent item to not_found', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:get'](APPROVED_EVENT, {
        inventoryItemId: 'does-not-exist'
      })
      expect(result).toEqual({ success: false, errorCode: 'not_found' })
    })
  })

  describe('safe error mapping', () => {
    it('never leaks a raw exception message or stack trace on a duplicate-code failure', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      createItem(handlers, { code: 'FLOUR' })
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        code: 'FLOUR'
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('Error:')
      expect(serialized).not.toContain('DuplicateInventoryItemCodeError')
    })
  })

  describe('never accepts privileged fields from renderer input', () => {
    it('createInventoryItem ignores injected actor/sessionId/companyId/isActive/timestamp fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:create'](APPROVED_EVENT, {
        ...VALID_CREATE_INPUT,
        actor: { type: 'user', userId: 'someone-else' },
        sessionId: 'stolen-session-id',
        companyId: 'some-other-company',
        isActive: false,
        createdAt: 1,
        updatedAt: 1
      }) as { success: true; inventoryItem: { isActive: boolean; code: string } }
      expect(result.success).toBe(true)
      expect(result.inventoryItem.isActive).toBe(true)
      expect(result.inventoryItem.code).toBe('FLOUR')
    })

    it('updateInventoryItem ignores an injected code field -- code remains unchanged', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const item = createItem(handlers)
      const result = handlers['inventory-items:update'](APPROVED_EVENT, {
        inventoryItemId: item.id,
        name: 'Renamed',
        code: 'HACKED'
      }) as { success: true; inventoryItem: { code: string; name: string } }
      expect(result.success).toBe(true)
      expect(result.inventoryItem.code).toBe(item.code)
      expect(result.inventoryItem.name).toBe('Renamed')
    })

    it('updateInventoryItem ignores an injected itemType field -- itemType remains unchanged', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const item = createItem(handlers, { itemType: 'ingredient' })
      const result = handlers['inventory-items:update'](APPROVED_EVENT, {
        inventoryItemId: item.id,
        name: 'Renamed',
        itemType: 'packaging'
      }) as { success: true; inventoryItem: { itemType: string } }
      expect(result.success).toBe(true)
      expect(result.inventoryItem.itemType).toBe('ingredient')
    })
  })

  describe('listAssignableUnitsOfMeasure', () => {
    it('returns only active units, in the narrow {id, code, name, category} shape', async () => {
      await createUserWithRole('owner', 'role_owner')
      deactivateUnit('uom_l')

      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:list-assignable-units'](APPROVED_EVENT) as {
        success: true
        units: { id: string; code: string; name: string; category: string }[]
      }

      expect(result.success).toBe(true)
      expect(result.units.some((u) => u.id === 'uom_l')).toBe(false)
      const kgUnit = result.units.find((u) => u.id === 'uom_kg')
      expect(kgUnit).toBeDefined()
      expect(Object.keys(kgUnit!).sort()).toEqual(['category', 'code', 'id', 'name'].sort())
    })

    it('is gated by inventory_items.read, so Operations can still see it', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      const result = handlers['inventory-items:list-assignable-units'](APPROVED_EVENT) as {
        success: boolean
      }
      expect(result.success).toBe(true)
    })

    it('never includes decimal-places, sort-order, or other reference-data internals', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-items:list-assignable-units'](APPROVED_EVENT) as {
        success: true
        units: unknown[]
      }
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('decimalPlaces')
      expect(serialized).not.toContain('sortOrder')
      expect(serialized).not.toContain('sort_order')
    })

    it('a logged-out caller is rejected as session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['inventory-items:list-assignable-units'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })
  })
})

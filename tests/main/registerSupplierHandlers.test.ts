import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { createInventoryItem } from '../../src/main/db/inventoryItemService'
import { createUser, deactivateUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { userRoles } from '../../src/main/db/schema'
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
  'suppliers:list',
  'suppliers:get',
  'suppliers:create',
  'suppliers:update',
  'suppliers:deactivate',
  'suppliers:reactivate',
  'suppliers:record-price',
  'suppliers:list-prices-for-supplier',
  'suppliers:list-prices-for-inventory-item',
  'suppliers:get-current-price'
]

const VALID_ITEM_INPUT = {
  code: 'flour',
  name: 'Flour',
  category: 'Dry goods',
  itemType: 'ingredient',
  unitOfMeasureId: 'uom_kg',
  minimumStock: 0,
  reorderQuantity: 0,
  leadTimeDays: 0
}

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerSupplierHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-supplier-handlers')
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
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
    itemId = createInventoryItem(db, VALID_ITEM_INPUT, { type: 'system' }).id
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

  async function registerAndCapture(loggedInAs: string | null): Promise<{
    handlers: Record<string, Handler>
    channels: string[]
    loginService: LoginService
  }> {
    const { registerSupplierHandlers } = await import('../../src/main/ipc/registerSupplierHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerSupplierHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function createTestSupplier(
    handlers: Record<string, Handler>,
    name = 'Acme Foods'
  ): { id: string; code: string } {
    const result = handlers['suppliers:create'](APPROVED_EVENT, { name }) as {
      success: true
      supplier: { id: string; code: string }
    }
    return result.supplier
  }

  it('registers exactly the 10 expected suppliers channels -- no other channel', async () => {
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

  describe('authorization -- all four roles manage suppliers and pricing', () => {
    it.each([
      ['owner', 'role_owner'],
      ['exec1', 'role_executive'],
      ['ops1', 'role_operations'],
      ['fin1', 'role_finance']
    ])('%s can read and manage suppliers and record prices', async (loginIdentifier, roleId) => {
      await createUserWithRole(loginIdentifier, roleId)
      const { handlers } = await registerAndCapture(loginIdentifier)
      expect((handlers['suppliers:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )
      const supplier = createTestSupplier(handlers)
      expect(supplier.code).toBe('SUP-000001')
      const priceResult = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 500,
        effectiveFrom: Date.now()
      }) as { success: boolean }
      expect(priceResult.success).toBe(true)
    })

    it('a logged-out caller is rejected as session_invalid on both read and manage channels', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['suppliers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(handlers['suppliers:create'](APPROVED_EVENT, { name: 'X' })).toEqual({
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

      expect(handlers['suppliers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session is rejected as session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['suppliers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect((handlers['suppliers:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )

      // Removing every role leaves the caller with none at all -- even
      // though every defined role currently grants suppliers.manage,
      // authorization must still be re-resolved from SQLite on every
      // call rather than trusting anything cached from login time.
      db.delete(userRoles).run()

      const result = handlers['suppliers:create'](APPROVED_EVENT, { name: 'X' })
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })

  describe('input validation', () => {
    it('rejects a non-object createSupplier input as invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['suppliers:create'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createSupplier input missing the required name field', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['suppliers:create'](APPROVED_EVENT, {})).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a non-number priceMinor', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      expect(
        handlers['suppliers:record-price'](APPROVED_EVENT, {
          supplierId: supplier.id,
          inventoryItemId: itemId,
          priceMinor: '500',
          effectiveFrom: Date.now()
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a supplierId input that is not an object', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['suppliers:get'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })
  })

  describe('active supplier / item requirement for recording a price', () => {
    it('rejects recording a price against an inactive supplier', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      handlers['suppliers:deactivate'](APPROVED_EVENT, { supplierId: supplier.id })
      const result = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 500,
        effectiveFrom: Date.now()
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })
  })

  describe('duplicate effective timestamp', () => {
    it('maps a duplicate (supplierId, inventoryItemId, effectiveFrom) to duplicate_effective_price', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      const effectiveFrom = Date.now()
      handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 500,
        effectiveFrom
      })
      const result = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 600,
        effectiveFrom
      })
      expect(result).toEqual({ success: false, errorCode: 'duplicate_effective_price' })
    })
  })

  describe('current-price lookup excludes future-dated rows', () => {
    it('a future-dated price is never returned as current', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      const past = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 100,
        effectiveFrom: Date.now() - 86400000
      }) as { success: true; price: { id: string } }
      handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 999,
        effectiveFrom: Date.now() + 86400000
      })

      const current = handlers['suppliers:get-current-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId
      }) as { success: true; price: { id: string; priceMinor: number } | null }
      expect(current.price?.id).toBe(past.price.id)
      expect(current.price?.priceMinor).toBe(100)
    })
  })

  describe('safe error mapping', () => {
    it('never leaks a raw exception message or stack trace on a duplicate-price failure', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      const effectiveFrom = Date.now()
      handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 100,
        effectiveFrom
      })
      const result = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 200,
        effectiveFrom
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('Error:')
      expect(serialized).not.toContain('DuplicateEffectivePriceError')
    })
  })

  describe('never accepts privileged fields from renderer input', () => {
    it('createSupplier ignores injected code/actor/sessionId/isActive/timestamp fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['suppliers:create'](APPROVED_EVENT, {
        name: 'Acme Foods',
        code: 'HACKED',
        actor: { type: 'user', userId: 'someone-else' },
        sessionId: 'stolen-session-id',
        companyId: 'some-other-company',
        isActive: false,
        createdAt: 1,
        updatedAt: 1
      }) as { success: true; supplier: { code: string; isActive: boolean } }
      expect(result.success).toBe(true)
      expect(result.supplier.code).toBe('SUP-000001')
      expect(result.supplier.isActive).toBe(true)
    })

    it('updateSupplier ignores an injected code field -- code remains unchanged', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      const result = handlers['suppliers:update'](APPROVED_EVENT, {
        supplierId: supplier.id,
        name: 'Renamed',
        code: 'HACKED'
      }) as { success: true; supplier: { code: string; name: string } }
      expect(result.success).toBe(true)
      expect(result.supplier.code).toBe(supplier.code)
      expect(result.supplier.name).toBe('Renamed')
    })

    it('recordSupplierPrice ignores an injected currencyId -- always FUNCTIONAL_CURRENCY_ID', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const supplier = createTestSupplier(handlers)
      const result = handlers['suppliers:record-price'](APPROVED_EVENT, {
        supplierId: supplier.id,
        inventoryItemId: itemId,
        priceMinor: 500,
        effectiveFrom: Date.now(),
        currencyId: 'currency_eur'
      }) as { success: true; price: { currencyId: string } }
      expect(result.success).toBe(true)
      expect(result.price.currencyId).toBe('currency_usd')
    })
  })

  describe('no update or delete surface for supplier prices', () => {
    it('registers no price-update or price-delete channel of any name, and no service/preload update or delete surface exists', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')

      // IPC layer: no channel name suggesting an update/delete/edit
      // operation on a supplier price exists among the registered
      // channels -- checked broadly, not just the two most obvious
      // guesses, so a differently-named update/delete channel would
      // still be caught.
      const priceRelatedChannels = channels.filter((c) => c.includes('price'))
      for (const channel of priceRelatedChannels) {
        expect(channel).not.toMatch(/update|delete|edit|remove/i)
      }
      expect(priceRelatedChannels.sort()).toEqual(
        [
          'suppliers:record-price',
          'suppliers:list-prices-for-supplier',
          'suppliers:list-prices-for-inventory-item',
          'suppliers:get-current-price'
        ].sort()
      )

      // Service layer: supplierPriceService.ts exports no
      // update/delete/deactivate/reactivate function for prices --
      // structural, not just a naming convention.
      const supplierPriceService = await import('../../src/main/db/supplierPriceService')
      const exportedNames = Object.keys(supplierPriceService)
      for (const name of exportedNames) {
        if (/^(update|delete|deactivate|reactivate)/i.test(name)) {
          expect.fail(`Unexpected mutating export on an append-only table: ${name}`)
        }
      }
      expect(exportedNames.sort()).toEqual(
        [
          'SupplierPriceServiceError',
          'DuplicateEffectivePriceError',
          'recordSupplierPrice',
          'listPricesForSupplier',
          'listPricesForInventoryItem',
          'getCurrentPriceForSupplierItem'
        ].sort()
      )
    })
  })
})

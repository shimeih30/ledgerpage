import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import { numberingRuleId } from '../../src/main/db/numberingDefaults'
import { createUser, deactivateUser } from '../../src/main/auth/userService'
import { hashPassword } from '../../src/main/auth/passwordHashing'
import { createTaxCode, deactivateTaxCode } from '../../src/main/db/taxCodeService'
import { createTaxRateVersion } from '../../src/main/db/taxRateVersionService'
import { numberingRules, PRIMARY_COMPANY_ID, userRoles } from '../../src/main/db/schema'
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
  'products:list',
  'products:get',
  'products:create',
  'products:update',
  'products:deactivate',
  'products:reactivate',
  'product-variants:list-for-product',
  'product-variants:get',
  'product-variants:create',
  'product-variants:update',
  'product-variants:deactivate',
  'product-variants:reactivate',
  'products:list-assignable-tax-codes'
]

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerProductHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-product-handlers')
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
    const now = new Date()
    db.insert(numberingRules)
      .values({
        id: numberingRuleId('product'),
        companyId: PRIMARY_COMPANY_ID,
        documentTypeKey: 'product',
        prefix: 'PRD',
        paddingLength: 6,
        resetBehavior: 'never',
        currentSequenceValue: 0,
        currentSequenceYear: null,
        createdAt: now,
        updatedAt: now
      })
      .run()
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
    const { registerProductHandlers } = await import('../../src/main/ipc/registerProductHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerProductHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function createManufacturedProduct(handlers: Record<string, Handler>): {
    id: string
    code: string
  } {
    const result = handlers['products:create'](APPROVED_EVENT, {
      name: 'Jam',
      type: 'manufactured'
    }) as { success: true; product: { id: string; code: string } }
    return result.product
  }

  it('registers exactly the 12 expected products/product-variants channels -- no other mutation channel', async () => {
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
      expect((handlers['products:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const created = createManufacturedProduct(handlers)
      expect(created.code).toBe('PRD-000001')
    })

    it('an active Executive can read and manage', async () => {
      await createUserWithRole('exec1', 'role_executive')
      const { handlers } = await registerAndCapture('exec1')
      expect((handlers['products:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const created = createManufacturedProduct(handlers)
      expect(created.code).toBe('PRD-000001')
    })

    it('an active Operations user can read and manage', async () => {
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      expect((handlers['products:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const created = createManufacturedProduct(handlers)
      expect(created.code).toBe('PRD-000001')
    })

    it('an active Finance user can read but cannot manage', async () => {
      await createUserWithRole('fin1', 'role_finance')
      const { handlers } = await registerAndCapture('fin1')
      expect((handlers['products:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)
      const result = handlers['products:create'](APPROVED_EVENT, {
        name: 'Jam',
        type: 'manufactured'
      })
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('a Finance user is also rejected from every variant mutation channel', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers: ownerHandlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(ownerHandlers)

      await createUserWithRole('fin2', 'role_finance')
      const { handlers } = await registerAndCapture('fin2')
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'X',
        name: 'X',
        sellingPriceMinor: 0
      })
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })

    it('a logged-out caller is rejected as session_invalid on both read and manage channels', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['products:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(
        handlers['products:create'](APPROVED_EVENT, { name: 'X', type: 'manufactured' })
      ).toEqual({ success: false, errorCode: 'session_invalid' })
    })

    it('a locked session is rejected as session_invalid', async () => {
      await createUserWithRole('owner2', 'role_owner')
      const { handlers, loginService } = await registerAndCapture('owner2')
      loginService.startIdleLockTimer(db, { lockAfterIdleMs: 20, checkIntervalMs: 10 })
      await new Promise((resolve) => setTimeout(resolve, 100))
      loginService.dispose()
      expect(loginService.getSessionState(db).state).toBe('locked')

      expect(handlers['products:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session is rejected as session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['products:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      const userId = await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect((handlers['products:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(true)

      db.delete(userRoles).run()
      db.insert(userRoles).values({ userId, roleId: 'role_finance', createdAt: new Date() }).run()

      const result = handlers['products:create'](APPROVED_EVENT, {
        name: 'X',
        type: 'manufactured'
      })
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })

  describe('input validation', () => {
    it('rejects a non-object createProduct input as invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['products:create'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createProduct input missing name', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['products:create'](APPROVED_EVENT, { type: 'manufactured' })).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createProduct input with a non-string type', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['products:create'](APPROVED_EVENT, { name: 'X', type: 123 })).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects an out-of-range type value as invalid_input via the service-layer check', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['products:create'](APPROVED_EVENT, { name: 'X', type: 'not-a-type' })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a createVariant input missing required fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      expect(
        handlers['product-variants:create'](APPROVED_EVENT, { productId: product.id })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a createVariant input with a non-number sellingPriceMinor', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      expect(
        handlers['product-variants:create'](APPROVED_EVENT, {
          productId: product.id,
          code: 'X',
          name: 'X',
          sellingPriceMinor: '500'
        })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a productId input that is not an object', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['products:get'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })
  })

  describe('duplicate/validation error mapping', () => {
    it('maps a duplicate variant code to duplicate_code', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0
      })
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'a',
        name: 'B',
        sellingPriceMinor: 0
      })
      expect(result).toEqual({ success: false, errorCode: 'duplicate_code' })
    })

    it('maps a duplicate barcode to duplicate_barcode', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0,
        barcode: '12345'
      })
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'B',
        name: 'B',
        sellingPriceMinor: 0,
        barcode: '12345'
      })
      expect(result).toEqual({ success: false, errorCode: 'duplicate_barcode' })
    })

    it('maps a negative selling price to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: -1
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps an inactive tax code assignment to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      const taxCode = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        { type: 'system' }
      )
      deactivateTaxCode(db, taxCode.id, { type: 'system' })
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0,
        taxCodeId: taxCode.id
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps a nonzero stock level on a service variant to invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const serviceResult = handlers['products:create'](APPROVED_EVENT, {
        name: 'Delivery',
        type: 'service'
      }) as { success: true; product: { id: string } }
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: serviceResult.product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0,
        minimumFinishedStockLevel: 5
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('maps a request against a nonexistent product to not_found', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['products:get'](APPROVED_EVENT, { productId: 'does-not-exist' })
      expect(result).toEqual({ success: false, errorCode: 'not_found' })
    })
  })

  describe('safe error mapping', () => {
    it('never leaks a raw exception message or stack trace on a duplicate-code failure', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0
      })
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'A',
        name: 'A',
        sellingPriceMinor: 0
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('Error:')
      expect(serialized).not.toContain('DuplicateVariantCodeError')
    })
  })

  describe('never accepts privileged fields from renderer input', () => {
    it('createProduct ignores an injected actor/session-id/code field and still allocates the real code', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['products:create'](APPROVED_EVENT, {
        name: 'X',
        type: 'manufactured',
        code: 'HACKED-000001',
        actor: { type: 'user', userId: 'someone-else' },
        sessionId: 'stolen-session-id'
      }) as { success: true; product: { code: string } }
      expect(result.product.code).toBe('PRD-000001')
    })

    it('createVariant ignores an injected currencyId field and still stores the functional currency', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const product = createManufacturedProduct(handlers)
      const result = handlers['product-variants:create'](APPROVED_EVENT, {
        productId: product.id,
        code: 'X',
        name: 'X',
        sellingPriceMinor: 0,
        currencyId: 'currency_zwg'
      }) as { success: true; variant: { currencyId: string } }
      expect(result.variant.currencyId).toBe('currency_usd')
    })
  })

  describe('listAssignableTaxCodes', () => {
    it('returns only active tax codes, in the narrow {id, code, name} shape', async () => {
      await createUserWithRole('owner', 'role_owner')
      const activeTaxCode = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        { type: 'system' }
      )
      const inactiveTaxCode = createTaxCode(
        db,
        { code: 'OLD', name: 'Old rate', category: 'standard' },
        { type: 'system' }
      )
      deactivateTaxCode(db, inactiveTaxCode.id, { type: 'system' })

      const { handlers } = await registerAndCapture('owner')
      const result = handlers['products:list-assignable-tax-codes'](APPROVED_EVENT) as {
        success: true
        taxCodes: { id: string; code: string; name: string }[]
      }

      expect(result.taxCodes).toEqual([{ id: activeTaxCode.id, code: 'STD', name: 'Standard' }])
      // Never a rate, category, description, or company id -- the
      // shape is exactly {id, code, name}, nothing more.
      expect(Object.keys(result.taxCodes[0]).sort()).toEqual(['code', 'id', 'name'].sort())
    })

    it('is gated by products.read, so Operations (which lacks tax.read) can still see it', async () => {
      const activeTaxCode = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        { type: 'system' }
      )
      await createUserWithRole('ops1', 'role_operations')
      const { handlers } = await registerAndCapture('ops1')
      const result = handlers['products:list-assignable-tax-codes'](APPROVED_EVENT) as {
        success: true
        taxCodes: { id: string }[]
      }
      expect(result.success).toBe(true)
      expect(result.taxCodes).toEqual([{ id: activeTaxCode.id, code: 'STD', name: 'Standard' }])
    })

    it('never includes a rate, percentage, or any rate-version data, even when a real rate is configured for the tax code', async () => {
      await createUserWithRole('owner', 'role_owner')
      const taxCode = createTaxCode(
        db,
        { code: 'VAT15', name: 'VAT 15%', category: 'standard' },
        { type: 'system' }
      )
      db.transaction((tx) =>
        createTaxRateVersion(
          tx,
          { taxCodeId: taxCode.id, ratePpm: 150000, effectiveFrom: '2026-01-01' },
          { type: 'system' }
        )
      )

      const { handlers } = await registerAndCapture('owner')
      const result = handlers['products:list-assignable-tax-codes'](APPROVED_EVENT) as {
        success: true
        taxCodes: unknown[]
      }
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('150000')
      expect(serialized).not.toContain('ratePpm')
      expect(serialized).not.toContain('effectiveFrom')
      expect(serialized).not.toMatch(/rate/i)
    })

    it('a logged-out caller is rejected as session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['products:list-assignable-tax-codes'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })
  })
})

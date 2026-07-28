import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
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
  'customers:list',
  'customers:get',
  'customers:create',
  'customers:update',
  'customers:deactivate',
  'customers:reactivate',
  'customers:list-contacts',
  'customers:get-contact',
  'customers:create-contact',
  'customers:update-contact',
  'customers:deactivate-contact',
  'customers:reactivate-contact'
]

type Handler = (event: unknown, input?: unknown) => unknown

describe('registerCustomerHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-customer-handlers')
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
           VALUES ('numbering_rule_customer', 'primary_company', 'customer', 'CUS', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
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
    const { registerCustomerHandlers } = await import('../../src/main/ipc/registerCustomerHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerCustomerHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function createTestCustomer(
    handlers: Record<string, Handler>,
    name = 'Acme Retail'
  ): { id: string; code: string } {
    const result = handlers['customers:create'](APPROVED_EVENT, { name }) as {
      success: true
      customer: { id: string; code: string }
    }
    return result.customer
  }

  it('registers exactly the 12 expected customers channels -- no other channel', async () => {
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

  describe('authorization -- all four roles read and manage customers and contacts', () => {
    it.each([
      ['owner', 'role_owner'],
      ['exec1', 'role_executive'],
      ['ops1', 'role_operations'],
      ['fin1', 'role_finance']
    ])('%s can read and manage customers and contacts', async (loginIdentifier, roleId) => {
      await createUserWithRole(loginIdentifier, roleId)
      const { handlers } = await registerAndCapture(loginIdentifier)
      expect((handlers['customers:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )
      const customer = createTestCustomer(handlers)
      expect(customer.code).toBe('CUS-000001')
      const contactResult = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Jane Doe'
      }) as { success: boolean }
      expect(contactResult.success).toBe(true)
    })

    it('a logged-out caller is rejected as session_invalid on both read and manage channels', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['customers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
      expect(handlers['customers:create'](APPROVED_EVENT, { name: 'X' })).toEqual({
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

      expect(handlers['customers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session is rejected as session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['customers:list'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect((handlers['customers:list'](APPROVED_EVENT) as { success: boolean }).success).toBe(
        true
      )

      db.delete(userRoles).run()

      const result = handlers['customers:create'](APPROVED_EVENT, { name: 'X' })
      expect(result).toEqual({ success: false, errorCode: 'not_authorized' })
    })
  })

  describe('input validation', () => {
    it('rejects a non-object createCustomer input as invalid_input', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['customers:create'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createCustomer input missing the required name field', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['customers:create'](APPROVED_EVENT, {})).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects an invalid paymentTermsDays', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['customers:create'](APPROVED_EVENT, { name: 'X', paymentTermsDays: -1 })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
      expect(
        handlers['customers:create'](APPROVED_EVENT, { name: 'X', paymentTermsDays: '30' })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects an invalid creditLimitMinor', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(
        handlers['customers:create'](APPROVED_EVENT, { name: 'X', creditLimitMinor: -1 })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
      expect(
        handlers['customers:create'](APPROVED_EVENT, { name: 'X', creditLimitMinor: '500' })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a customerId input that is not an object', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['customers:get'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a createCustomerContact input missing the required name field', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      expect(
        handlers['customers:create-contact'](APPROVED_EVENT, { customerId: customer.id })
      ).toEqual({ success: false, errorCode: 'invalid_input' })
    })
  })

  describe('duplicate customer code', () => {
    it('the numbering allocator itself guarantees sequential, non-duplicate codes', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const first = createTestCustomer(handlers, 'Acme Retail')
      const second = createTestCustomer(handlers, 'Beta Traders')
      expect(first.code).toBe('CUS-000001')
      expect(second.code).toBe('CUS-000002')
      expect(first.code).not.toBe(second.code)
    })
  })

  describe('inactive parent customer blocks contact mutations, but not reads', () => {
    it('rejects creating a contact for an inactive customer', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      handlers['customers:deactivate'](APPROVED_EVENT, { customerId: customer.id })
      const result = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Jane Doe'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects updating a contact whose parent customer has since been deactivated', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      const contactResult = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Jane Doe'
      }) as { success: true; contact: { id: string } }
      handlers['customers:deactivate'](APPROVED_EVENT, { customerId: customer.id })
      const result = handlers['customers:update-contact'](APPROVED_EVENT, {
        contactId: contactResult.contact.id,
        name: 'Jane Smith'
      })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('contact reads still work for inactive parents', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      const contactResult = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Jane Doe'
      }) as { success: true; contact: { id: string } }
      handlers['customers:deactivate'](APPROVED_EVENT, { customerId: customer.id })

      const listResult = handlers['customers:list-contacts'](APPROVED_EVENT, {
        customerId: customer.id
      }) as { success: true; contacts: unknown[] }
      expect(listResult.success).toBe(true)
      expect(listResult.contacts).toHaveLength(1)

      const getResult = handlers['customers:get-contact'](APPROVED_EVENT, {
        contactId: contactResult.contact.id
      }) as { success: true }
      expect(getResult.success).toBe(true)
    })
  })

  describe('safe error mapping', () => {
    it('never leaks a raw exception message or stack trace on an inactive-parent failure', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      handlers['customers:deactivate'](APPROVED_EVENT, { customerId: customer.id })
      const result = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Jane Doe'
      })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('Error:')
      expect(serialized).not.toContain('CustomerContactServiceError')
    })
  })

  describe('never accepts privileged fields from renderer input', () => {
    it('createCustomer ignores injected code/currencyId/actor/sessionId/companyId/isActive/timestamp fields', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['customers:create'](APPROVED_EVENT, {
        name: 'Acme Retail',
        code: 'HACKED',
        currencyId: 'currency_eur',
        actor: { type: 'user', userId: 'someone-else' },
        sessionId: 'stolen-session-id',
        companyId: 'some-other-company',
        isActive: false,
        createdAt: 1,
        updatedAt: 1
      }) as {
        success: true
        customer: { code: string; currencyId: string; isActive: boolean }
      }
      expect(result.success).toBe(true)
      expect(result.customer.code).toBe('CUS-000001')
      expect(result.customer.currencyId).toBe('currency_usd')
      expect(result.customer.isActive).toBe(true)
    })

    it('updateCustomer ignores an injected code field -- code remains unchanged', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      const result = handlers['customers:update'](APPROVED_EVENT, {
        customerId: customer.id,
        name: 'Renamed',
        code: 'HACKED'
      }) as { success: true; customer: { code: string; name: string } }
      expect(result.success).toBe(true)
      expect(result.customer.code).toBe(customer.code)
      expect(result.customer.name).toBe('Renamed')
    })

    it('updateCustomer ignores an injected currencyId field -- always FUNCTIONAL_CURRENCY_ID', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customer = createTestCustomer(handlers)
      const result = handlers['customers:update'](APPROVED_EVENT, {
        customerId: customer.id,
        currencyId: 'currency_eur'
      }) as { success: true; customer: { currencyId: string } }
      expect(result.success).toBe(true)
      expect(result.customer.currencyId).toBe('currency_usd')
    })

    it('updateCustomerContact ignores an injected customerId -- cannot move a contact to another customer', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const customerA = createTestCustomer(handlers, 'Acme Retail')
      const customerB = createTestCustomer(handlers, 'Beta Traders')
      const contactResult = handlers['customers:create-contact'](APPROVED_EVENT, {
        customerId: customerA.id,
        name: 'Jane Doe'
      }) as { success: true; contact: { id: string } }

      const result = handlers['customers:update-contact'](APPROVED_EVENT, {
        contactId: contactResult.contact.id,
        name: 'Jane Smith',
        customerId: customerB.id
      }) as { success: true; contact: { customerId: string } }
      expect(result.success).toBe(true)
      expect(result.contact.customerId).toBe(customerA.id)
    })
  })

  describe('no hard-delete surface for customer contacts', () => {
    it('registers no contact-delete/remove channel of any name, and no service/preload delete surface exists', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')

      const contactRelatedChannels = channels.filter((c) => c.includes('contact'))
      for (const channel of contactRelatedChannels) {
        expect(channel).not.toMatch(/delete|remove/i)
      }
      expect(contactRelatedChannels.sort()).toEqual(
        [
          'customers:list-contacts',
          'customers:get-contact',
          'customers:create-contact',
          'customers:update-contact',
          'customers:deactivate-contact',
          'customers:reactivate-contact'
        ].sort()
      )

      const customerContactService = await import('../../src/main/db/customerContactService')
      const exportedNames = Object.keys(customerContactService)
      for (const name of exportedNames) {
        expect(name.toLowerCase()).not.toContain('delete')
        expect(name.toLowerCase()).not.toContain('remove')
      }
    })
  })
})

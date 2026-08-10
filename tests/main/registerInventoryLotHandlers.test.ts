import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import { createCompany } from '../../src/main/db/companyService'
import {
  createInventoryItem,
  deactivateInventoryItem
} from '../../src/main/db/inventoryItemService'
import { createOpeningLot, setLotQuarantined } from '../../src/main/db/inventoryLotService'
import { recordAdjustment, reverseMovement } from '../../src/main/db/stockMovementService'
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
  'inventory-lots:list-for-item',
  'inventory-lots:get',
  'inventory-lots:list-movements',
  'stock:list-summaries',
  'stock:get-summary'
]

const FLOUR_ITEM_INPUT = {
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

describe('registerInventoryLotHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let itemId: string

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-inventory-lot-handlers')
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
           VALUES ('numbering_rule_inventory_lot', 'primary_company', 'inventory_lot', 'LOT', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
    itemId = createInventoryItem(db, FLOUR_ITEM_INPUT, { type: 'system' }).id
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
    const { registerInventoryLotHandlers } =
      await import('../../src/main/ipc/registerInventoryLotHandlers')
    const { createLoginService } = await import('../../src/main/users/loginService')
    const { createSessionManager } = await import('../../src/main/auth/sessionManager')
    const sessionManager = createSessionManager()
    const loginService = createLoginService({ sessionManager })

    if (loggedInAs) {
      await loginService.login(db, loggedInAs, REAL_PASSWORD)
    }

    registerInventoryLotHandlers({ context, db, loginService })

    const handlers: Record<string, Handler> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [string, Handler][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels, loginService }
  }

  function createTestLot(
    overrides: {
      quantityReceivedScaled?: number
      unitCostMinor?: number
      expiryDate?: Date
    } = {}
  ) {
    return createOpeningLot(
      db,
      {
        inventoryItemId: itemId,
        receivedDate: new Date('2026-01-01'),
        quantityReceivedScaled: overrides.quantityReceivedScaled ?? 20000,
        unitCostMinor: overrides.unitCostMinor ?? 350,
        expiryDate: overrides.expiryDate
      },
      { type: 'system' }
    )
  }

  it('registers exactly the 5 expected channels -- no other channel', async () => {
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

  describe('authorization -- all four roles can read', () => {
    it.each([
      ['owner', 'role_owner'],
      ['exec1', 'role_executive'],
      ['ops1', 'role_operations'],
      ['fin1', 'role_finance']
    ])(
      '%s can list lots, get a lot, list movements, and read stock summaries',
      async (loginIdentifier, roleId) => {
        const lot = createTestLot()
        await createUserWithRole(loginIdentifier, roleId)
        const { handlers } = await registerAndCapture(loginIdentifier)

        expect(
          (
            handlers['inventory-lots:list-for-item'](APPROVED_EVENT, {
              inventoryItemId: itemId
            }) as { success: boolean }
          ).success
        ).toBe(true)
        expect(
          (
            handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
              success: boolean
            }
          ).success
        ).toBe(true)
        expect(
          (
            handlers['inventory-lots:list-movements'](APPROVED_EVENT, { lotId: lot.id }) as {
              success: boolean
            }
          ).success
        ).toBe(true)
        expect(
          (handlers['stock:list-summaries'](APPROVED_EVENT) as { success: boolean }).success
        ).toBe(true)
        expect(
          (
            handlers['stock:get-summary'](APPROVED_EVENT, { inventoryItemId: itemId }) as {
              success: boolean
            }
          ).success
        ).toBe(true)
      }
    )

    it('a logged-out caller is rejected as session_invalid', async () => {
      const { handlers } = await registerAndCapture(null)
      expect(handlers['stock:list-summaries'](APPROVED_EVENT)).toEqual({
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

      expect(handlers['stock:list-summaries'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    }, 20000)

    it("a deactivated user's session is rejected as session_invalid", async () => {
      const userId = await createUserWithRole('owner3', 'role_owner')
      const { handlers } = await registerAndCapture('owner3')
      deactivateUser(db, userId)

      expect(handlers['stock:list-summaries'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'session_invalid'
      })
    })

    it('authorization uses fresh SQLite role codes, not session-cached ones', async () => {
      await createUserWithRole('owner4', 'role_owner')
      const { handlers } = await registerAndCapture('owner4')
      expect(
        (handlers['stock:list-summaries'](APPROVED_EVENT) as { success: boolean }).success
      ).toBe(true)

      db.delete(userRoles).run()

      expect(handlers['stock:list-summaries'](APPROVED_EVENT)).toEqual({
        success: false,
        errorCode: 'not_authorized'
      })
    })
  })

  describe('input validation', () => {
    it('rejects a malformed inventoryItemId', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-lots:list-for-item'](APPROVED_EVENT, {})).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
      expect(handlers['inventory-lots:list-for-item'](APPROVED_EVENT, 'not-an-object')).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })

    it('rejects a malformed lotId', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-lots:get'](APPROVED_EVENT, {})).toEqual({
        success: false,
        errorCode: 'invalid_input'
      })
    })
  })

  describe('safe not_found mapping', () => {
    it('a nonexistent lot returns not_found, not a thrown error', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      expect(handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: 'does-not-exist' })).toEqual({
        success: false,
        errorCode: 'not_found'
      })
    })

    it('a nonexistent item for stock:get-summary returns not_found, and never leaks a raw exception', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['stock:get-summary'](APPROVED_EVENT, {
        inventoryItemId: 'does-not-exist'
      })
      expect(result).toEqual({ success: false, errorCode: 'not_found' })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/at\s+\S+\s+\(/)
      expect(serialized).not.toContain('StockQuantityServiceError')
    })
  })

  describe('inactive items and historical/expired/quarantined lots remain readable', () => {
    it('a lot for a now-inactive item remains readable', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const lot = createTestLot()
      deactivateInventoryItem(db, itemId, { type: 'system' })

      const result = handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
        success: true
        lot: { id: string }
      }
      expect(result.success).toBe(true)
      expect(result.lot.id).toBe(lot.id)
    })

    it('an expired lot remains readable, with effectiveStatus "expired"', async () => {
      const expiryTrackedItemId = createInventoryItem(
        db,
        { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE' },
        { type: 'system' }
      ).id
      rawDb
        .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
        .run(expiryTrackedItemId)
      const expiredLot = createOpeningLot(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          receivedDate: new Date('2020-01-01'),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100,
          expiryDate: new Date('2020-06-01')
        },
        { type: 'system' }
      )

      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:get'](APPROVED_EVENT, {
        lotId: expiredLot.id
      }) as { success: true; lot: { lifecycleStatus: string; effectiveStatus: string } }
      expect(result.success).toBe(true)
      expect(result.lot.lifecycleStatus).toBe('active')
      expect(result.lot.effectiveStatus).toBe('expired')
    })

    it('a quarantined lot remains readable, with effectiveStatus "quarantined"', async () => {
      const lot = createTestLot()
      setLotQuarantined(db, lot.id, { type: 'system' })

      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
        success: true
        lot: { lifecycleStatus: string; effectiveStatus: string }
      }
      expect(result.success).toBe(true)
      expect(result.lot.lifecycleStatus).toBe('quarantined')
      expect(result.lot.effectiveStatus).toBe('quarantined')
    })

    it('effectiveStatus is "depleted" once a lot is fully consumed, taking priority over expiry', async () => {
      const expiryTrackedItemId = createInventoryItem(
        db,
        { ...FLOUR_ITEM_INPUT, code: 'PERISHABLE2' },
        { type: 'system' }
      ).id
      rawDb
        .prepare('UPDATE inventory_items SET expiry_tracked = 1 WHERE id = ?')
        .run(expiryTrackedItemId)
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: expiryTrackedItemId,
          receivedDate: new Date('2020-01-01'),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100,
          expiryDate: new Date('2020-06-01')
        },
        { type: 'system' }
      )
      recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: -1000,
          costDeltaMinor: -100,
          reason: 'Full write-off'
        },
        { type: 'system' }
      )

      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
        success: true
        lot: { lifecycleStatus: string; effectiveStatus: string }
      }
      expect(result.lot.lifecycleStatus).toBe('depleted')
      expect(result.lot.effectiveStatus).toBe('depleted')
    })

    it('effectiveStatus is "active" for a normal, non-expired, non-quarantined lot', async () => {
      const lot = createTestLot()
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
        success: true
        lot: { lifecycleStatus: string; effectiveStatus: string }
      }
      expect(result.lot.lifecycleStatus).toBe('active')
      expect(result.lot.effectiveStatus).toBe('active')
    })
  })

  describe('resolved labels and formatted quantities', () => {
    it('inventory-lots:get returns resolved item/unit labels and formatted quantities', async () => {
      const lot = createTestLot()
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:get'](APPROVED_EVENT, { lotId: lot.id }) as {
        success: true
        lot: {
          itemCode: string
          unitCode: string
          decimalPlaces: number
          formattedQuantityReceived: string
        }
      }
      expect(result.lot.itemCode).toBe('FLOUR')
      expect(result.lot.unitCode).toBe('kg')
      expect(result.lot.decimalPlaces).toBe(3)
      expect(result.lot.formattedQuantityReceived).toBe('20.000')
    })

    it('inventory-lots:list-movements returns a formatted physical delta', async () => {
      const lot = createTestLot()
      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:list-movements'](APPROVED_EVENT, {
        lotId: lot.id
      }) as { success: true; movements: { formattedPhysicalQuantityDelta: string }[] }
      expect(result.movements[0].formattedPhysicalQuantityDelta).toBe('20.000')
    })

    it('reverseMovement is visible through inventory-lots:list-movements, including reversedMovementId', async () => {
      const lot = createTestLot()
      const original = recordAdjustment(
        db,
        {
          inventoryLotId: lot.id,
          physicalQuantityDeltaScaled: -100,
          costDeltaMinor: -35,
          reason: 'X'
        },
        { type: 'system' }
      )
      const reversal = reverseMovement(db, original.id, 'Undo X', { type: 'system' })

      await createUserWithRole('owner', 'role_owner')
      const { handlers } = await registerAndCapture('owner')
      const result = handlers['inventory-lots:list-movements'](APPROVED_EVENT, {
        lotId: lot.id
      }) as { success: true; movements: { id: string; reversedMovementId: string | null }[] }
      const reversalRow = result.movements.find((m) => m.id === reversal.id)
      expect(reversalRow?.reversedMovementId).toBe(original.id)
    })
  })

  describe('no mutation channel exists', () => {
    it('none of the 5 registered channels match a mutation-shaped name', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')
      for (const channel of channels) {
        expect(channel).not.toMatch(
          /create|adjust|reserve|release|reverse|consume|quarantine|activate|update|delete/i
        )
      }
    })
  })

  describe('shared contract structural guarantees (src/shared/ipc/inventoryLots.ts)', () => {
    it('exports exactly five channel constants, each a distinct read-only channel string', async () => {
      const contract = await import('../../src/shared/ipc/inventoryLots')
      const channelConstantNames = Object.keys(contract).filter((name) => name.endsWith('_CHANNEL'))
      expect(channelConstantNames.sort()).toEqual(
        [
          'INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL',
          'INVENTORY_LOTS_GET_CHANNEL',
          'INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL',
          'STOCK_LIST_SUMMARIES_CHANNEL',
          'STOCK_GET_SUMMARY_CHANNEL'
        ].sort()
      )

      const channelValues = channelConstantNames.map(
        (name) => (contract as unknown as Record<string, string>)[name]
      )
      // All five channel string values are themselves distinct.
      expect(new Set(channelValues).size).toBe(5)
      for (const value of channelValues) {
        expect(value).not.toMatch(
          /create|record|reserve|release|reverse|consume|quarantine|activate|update|delete|adjust|mutate/i
        )
      }
    })

    it('exports no mutation-shaped function or constant of any kind', async () => {
      const contract = await import('../../src/shared/ipc/inventoryLots')
      const exportedNames = Object.keys(contract)
      const prohibitedSubstrings = [
        'create',
        'record',
        'reserve',
        'release',
        'reverse',
        'consume',
        'quarantine',
        'activate',
        'update',
        'delete',
        'adjust',
        'mutate'
      ]
      for (const name of exportedNames) {
        const lower = name.toLowerCase()
        for (const prohibited of prohibitedSubstrings) {
          expect(lower).not.toContain(prohibited)
        }
      }
    })

    it('registerInventoryLotHandlers registers no channel outside the five approved read channels', async () => {
      await createUserWithRole('owner', 'role_owner')
      const { channels } = await registerAndCapture('owner')
      const contract = await import('../../src/shared/ipc/inventoryLots')
      const approvedChannels = [
        contract.INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL,
        contract.INVENTORY_LOTS_GET_CHANNEL,
        contract.INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL,
        contract.STOCK_LIST_SUMMARIES_CHANNEL,
        contract.STOCK_GET_SUMMARY_CHANNEL
      ]
      expect(channels.sort()).toEqual([...approvedChannels].sort())
      expect(channels).toHaveLength(5)
    })
  })
})

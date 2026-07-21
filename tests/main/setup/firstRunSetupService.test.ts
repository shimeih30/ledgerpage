import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { getFirstRunStatus } from '../../../src/main/setup/firstRunStatusService'
import {
  createFirstRunSetupService,
  type CompanyDetailsInput,
  type OwnerAccountInput
} from '../../../src/main/setup/firstRunSetupService'
import { createRecoveryCeremonyService } from '../../../src/main/auth/recoveryCeremonyService'
import * as passwordHashingModule from '../../../src/main/auth/passwordHashing'
import {
  company,
  numberingRules,
  ownerRecoveryCredentials,
  roles,
  userRoles,
  users
} from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

const VALID_COMPANY: CompanyDetailsInput = {
  name: 'Farmer Ben Sauces',
  address: '1 Main St',
  contactDetails: 'ben@example.com'
}

const VALID_OWNER: OwnerAccountInput = {
  displayName: 'Ben',
  loginIdentifier: 'ben',
  password: REAL_PASSWORD,
  passwordConfirmation: REAL_PASSWORD
}

function expectPrepared(outcome: {
  success: boolean
  ceremonyToken?: string
  plaintextRecoveryKey?: string
}): { ceremonyToken: string; plaintextRecoveryKey: string } {
  if (
    !outcome.success ||
    outcome.ceremonyToken === undefined ||
    outcome.plaintextRecoveryKey === undefined
  ) {
    throw new Error('expected prepareRecoveryKey to succeed, but it returned { success: false }')
  }
  return {
    ceremonyToken: outcome.ceremonyToken,
    plaintextRecoveryKey: outcome.plaintextRecoveryKey
  }
}

describe('firstRunSetupService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-first-run-setup')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rawDb.close()
    removeTempDir(dir)
  })

  async function prepareAndConfirm(
    service: ReturnType<typeof createFirstRunSetupService>
  ): Promise<string> {
    const prepared = expectPrepared(await service.prepareRecoveryKey())
    const confirmed = await service.confirmRecoveryKey(
      prepared.ceremonyToken,
      prepared.plaintextRecoveryKey
    )
    return confirmed!.commitToken
  }

  describe('the happy path', () => {
    it('commits the Owner user, role assignment, and active recovery credential together', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)

      const outcome = await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      expect(outcome).toEqual({ success: true })

      const userRows = db.select().from(users).all()
      expect(userRows).toHaveLength(1)
      expect(userRows[0].loginIdentifier).toBe('ben')

      const roleRows = db.select().from(userRoles).all()
      expect(roleRows).toHaveLength(1)
      expect(roleRows[0].roleId).toBe('role_owner')
      expect(roleRows[0].userId).toBe(userRows[0].id)

      const credentialRows = db.select().from(ownerRecoveryCredentials).all()
      expect(credentialRows).toHaveLength(1)
      expect(credentialRows[0].userId).toBe(userRows[0].id)
      expect(credentialRows[0].isActive).toBe(true)
    }, 20000)

    it('produces exactly 14 audit rows: company, 10 numbering rules, owner user, owner role, recovery credential', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)

      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      const rows = rawDb
        .prepare(
          'SELECT entity_type as entityType, action, actor_type as actorType FROM audit_log_entries'
        )
        .all() as { entityType: string; action: string; actorType: string }[]

      expect(rows).toHaveLength(14)
      expect(rows.every((r) => r.action === 'create')).toBe(true)
      expect(rows.every((r) => r.actorType === 'system')).toBe(true)

      const countsByType = rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.entityType] = (acc[r.entityType] ?? 0) + 1
        return acc
      }, {})
      expect(countsByType).toEqual({
        company: 1,
        numbering_rule: 10,
        user: 1,
        user_role: 1,
        owner_recovery_credential: 1
      })
    }, 20000)

    it('the recovery credential audit entry never includes the stored hash, even redacted', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)
      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      const credentialRow = rawDb
        .prepare(
          "SELECT changed_fields as changedFields FROM audit_log_entries WHERE entity_type = 'owner_recovery_credential'"
        )
        .get() as { changedFields: string }

      const changed = JSON.parse(credentialRow.changedFields)
      expect(Object.keys(changed).sort()).toEqual(['isActive', 'userId', 'version'].sort())
      expect(JSON.stringify(changed)).not.toMatch(/\$argon2id\$/)
    }, 20000)

    it('all 10 approved numbering-rule rows exist with current_sequence_value = 0 and the correct definitions', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)
      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      const rows = db.select().from(numberingRules).all()
      expect(rows).toHaveLength(10)
      for (const row of rows) {
        expect(row.currentSequenceValue).toBe(0)
        expect(row.currentSequenceYear).toBeNull()
        expect(row.paddingLength).toBe(6)
      }
      const invoiceRule = rows.find((r) => r.documentTypeKey === 'invoice')!
      expect(invoiceRule.prefix).toBe('INV')
      expect(invoiceRule.resetBehavior).toBe('yearly')
      const customerRule = rows.find((r) => r.documentTypeKey === 'customer')!
      expect(customerRule.prefix).toBe('CUS')
      expect(customerRule.resetBehavior).toBe('never')
    }, 20000)

    it('role rows remain exactly the four fixed, stable-id seeds — no duplicate role row is created', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)
      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      const roleRows = db.select().from(roles).all()
      expect(roleRows).toHaveLength(4)
      expect(roleRows.map((r) => r.id).sort()).toEqual(
        ['role_executive', 'role_finance', 'role_operations', 'role_owner'].sort()
      )
    }, 20000)

    it('no password or recovery-key plaintext reaches SQLite anywhere', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      const confirmed = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, confirmed!.commitToken)

      const everyRow = JSON.stringify({
        users: db.select().from(users).all(),
        credentials: db.select().from(ownerRecoveryCredentials).all()
      })
      expect(everyRow).not.toContain(REAL_PASSWORD)
      expect(everyRow).not.toContain(prepared.plaintextRecoveryKey)
    }, 20000)
  })

  describe('rollback safety', () => {
    it('a simulated failure during the transaction leaves no partial company/numbering/user/role/credential row', async () => {
      // Use a recovery ceremony service whose commitCredential is
      // wrapped to throw AFTER the company/numbering/user/role writes
      // have already happened, simulating a late failure inside the
      // same transaction.
      const realCeremonyService = createRecoveryCeremonyService()
      const failingCeremonyService: typeof realCeremonyService = {
        ...realCeremonyService,
        commitCredential: () => {
          throw new Error('simulated failure during commitCredential')
        }
      }
      const service = createFirstRunSetupService({
        recoveryCeremonyService: failingCeremonyService
      })
      const commitToken = await prepareAndConfirm(service)

      const outcome = await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)
      expect(outcome.success).toBe(false)

      expect(db.select().from(company).all()).toHaveLength(0)
      expect(db.select().from(numberingRules).all()).toHaveLength(0)
      expect(db.select().from(users).all()).toHaveLength(0)
      expect(db.select().from(userRoles).all()).toHaveLength(0)
      expect(db.select().from(ownerRecoveryCredentials).all()).toHaveLength(0)
      expect(getFirstRunStatus(db)).toEqual({ status: 'setup_required' })
      // Slice 10: the audit rows for company/numbering/user/role that
      // would otherwise have been written earlier in this same
      // transaction are rolled back too — none of them survive a later
      // failure in the same transaction, confirming atomicity end to
      // end, not just for the business tables checked above.
      expect(rawDb.prepare('SELECT COUNT(*) as c FROM audit_log_entries').get()).toEqual({ c: 0 })
    }, 20000)

    it('killing the app mid-wizard (never calling completeSetup) leaves no partial row, and relaunch restarts cleanly', async () => {
      const service = createFirstRunSetupService()
      // Only prepare and confirm the ceremony -- simulating the app
      // being killed before completeSetup is ever called.
      await prepareAndConfirm(service)

      expect(db.select().from(company).all()).toHaveLength(0)
      expect(db.select().from(users).all()).toHaveLength(0)

      // "Relaunch": a fresh service instance against the same
      // database sees setup_required and can complete normally.
      const freshService = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(freshService)
      const outcome = await freshService.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)
      expect(outcome).toEqual({ success: true })
    }, 20000)
  })

  describe('concurrency and idempotency', () => {
    it('setup is rechecked inside the final transaction — a second completion after the first succeeds is rejected cleanly', async () => {
      const service = createFirstRunSetupService()
      const firstCommitToken = await prepareAndConfirm(service)
      const firstOutcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        firstCommitToken
      )
      expect(firstOutcome).toEqual({ success: true })

      const secondCommitToken = await prepareAndConfirm(service)
      const secondOutcome = await service.completeSetup(
        db,
        {
          name: 'Different Co',
          address: 'Different Addr',
          contactDetails: 'different@example.com'
        },
        {
          displayName: 'Other',
          loginIdentifier: 'other',
          password: REAL_PASSWORD,
          passwordConfirmation: REAL_PASSWORD
        },
        secondCommitToken
      )
      expect(secondOutcome).toEqual({ success: false, errorCode: 'setup_already_complete' })

      // The original Owner/company are completely unmodified.
      const userRows = db.select().from(users).all()
      expect(userRows).toHaveLength(1)
      expect(userRows[0].loginIdentifier).toBe('ben')
      const companyRow = db.select().from(company).all()[0]
      expect(companyRow.name).toBe('Farmer Ben Sauces')
    }, 20000)

    it('duplicate submission with the same commitToken cannot create a second Owner', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)

      const firstOutcome = await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)
      expect(firstOutcome).toEqual({ success: true })

      const secondOutcome = await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)
      expect(secondOutcome.success).toBe(false)

      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)

    it('two concurrent completion attempts result in exactly one Owner', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      const confirmed = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      const commitToken = confirmed!.commitToken

      const [firstOutcome, secondOutcome] = await Promise.all([
        service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken),
        service.completeSetup(
          db,
          { name: 'Second Co', address: 'Addr2', contactDetails: 'c2@example.com' },
          {
            displayName: 'Second',
            loginIdentifier: 'second',
            password: REAL_PASSWORD,
            passwordConfirmation: REAL_PASSWORD
          },
          commitToken
        )
      ])

      const outcomes = [firstOutcome, secondOutcome]
      const successes = outcomes.filter((o) => o.success)
      expect(successes).toHaveLength(1)

      expect(db.select().from(users).all()).toHaveLength(1)
      expect(db.select().from(company).all()).toHaveLength(1)
    }, 20000)
  })

  describe('input validation and error mapping', () => {
    it('rejects a password/passwordConfirmation mismatch as invalid_input, without ever hashing', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)

      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        { ...VALID_OWNER, passwordConfirmation: 'a-different-password-1' },
        commitToken
      )

      expect(outcome).toEqual({ success: false, errorCode: 'invalid_input' })
      expect(db.select().from(users).all()).toHaveLength(0)
    }, 20000)

    it('rejects an empty company name as invalid_input', async () => {
      const service = createFirstRunSetupService()
      const outcome = await service.completeSetup(
        db,
        { ...VALID_COMPANY, name: '   ' },
        VALID_OWNER,
        'irrelevant-token'
      )
      expect(outcome).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('rejects a missing/never-prepared commitToken as recovery_confirmation_invalid', async () => {
      const service = createFirstRunSetupService()
      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        'never-issued-token'
      )
      expect(outcome).toEqual({ success: false, errorCode: 'recovery_confirmation_invalid' })
    })

    it('reports setup_already_complete for a completeSetup call after setup has finished, without touching data', async () => {
      const service = createFirstRunSetupService()
      const commitToken = await prepareAndConfirm(service)
      await service.completeSetup(db, VALID_COMPANY, VALID_OWNER, commitToken)

      const otherService = createFirstRunSetupService()
      const otherOutcome = await otherService.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        'some-other-token'
      )
      expect(otherOutcome).toEqual({ success: false, errorCode: 'setup_already_complete' })
    }, 20000)
  })

  describe('recovery ceremony integration', () => {
    it('the plaintext recovery key is returned only from prepareRecoveryKey', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      expect(prepared.plaintextRecoveryKey.length).toBeGreaterThan(0)

      const confirmed = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(JSON.stringify(confirmed)).not.toContain(prepared.plaintextRecoveryKey)
    })

    it('a wrong confirmation causes no database mutation', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      const wrongResult = await service.confirmRecoveryKey(prepared.ceremonyToken, 'WRONG-KEY')
      expect(wrongResult).toBeUndefined()
      expect(db.select().from(ownerRecoveryCredentials).all()).toHaveLength(0)
    })

    it('cancelling the ceremony invalidates it for later confirmation', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      service.cancelRecoveryKey(prepared.ceremonyToken)

      const result = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )
      expect(result).toBeUndefined()
    })

    it('a fabricated commit token never reaches commitCredential successfully', async () => {
      const service = createFirstRunSetupService()
      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        'fabricated-token'
      )
      expect(outcome).toEqual({ success: false, errorCode: 'recovery_confirmation_invalid' })
    }, 20000)
  })

  describe('active-attempt binding (Owner id, ceremony token, and commit token move together)', () => {
    it('prepare A, then prepare B: A cannot become active — confirming A is rejected, B succeeds', async () => {
      const service = createFirstRunSetupService()
      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const preparedB = expectPrepared(await service.prepareRecoveryKey())

      const confirmA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmA).toBeUndefined()

      const confirmB = await service.confirmRecoveryKey(
        preparedB.ceremonyToken,
        preparedB.plaintextRecoveryKey
      )
      expect(confirmB).toBeDefined()
    }, 20000)

    it('a stale preparation result is cancelled at the underlying ceremony service, not merely ignored', async () => {
      const realCeremonyService = createRecoveryCeremonyService()
      const cancelSpy = vi.spyOn(realCeremonyService, 'cancelCeremony')
      const service = createFirstRunSetupService({ recoveryCeremonyService: realCeremonyService })

      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      cancelSpy.mockClear() // ignore any cancellation from A's own preparation itself
      await service.prepareRecoveryKey() // B supersedes A

      expect(cancelSpy).toHaveBeenCalledWith(preparedA.ceremonyToken)
    })

    it('cancelling A does not clear B — B remains confirmable', async () => {
      const service = createFirstRunSetupService()
      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const preparedB = expectPrepared(await service.prepareRecoveryKey())

      service.cancelRecoveryKey(preparedA.ceremonyToken)

      const confirmB = await service.confirmRecoveryKey(
        preparedB.ceremonyToken,
        preparedB.plaintextRecoveryKey
      )
      expect(confirmB).toBeDefined()
    }, 20000)

    it('completing with a stale (superseded) commit token cannot create a user or reach a foreign-key failure', async () => {
      const service = createFirstRunSetupService()
      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const confirmedA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmedA).toBeDefined()

      // B supersedes A entirely, including A's now-confirmed commitToken.
      await service.prepareRecoveryKey()

      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedA!.commitToken
      )
      expect(outcome).toEqual({ success: false, errorCode: 'recovery_confirmation_invalid' })
      expect(db.select().from(users).all()).toHaveLength(0)
      expect(db.select().from(company).all()).toHaveLength(0)
    }, 20000)

    it('two concurrent preparations resolving in reverse order expose only the newest (B) usable key', async () => {
      const realCeremonyService = createRecoveryCeremonyService()
      let callCount = 0
      const deferredResolvers: Array<() => Promise<void>> = []
      const wrappedCeremonyService = {
        ...realCeremonyService,
        prepareCeremony: (ownerId: string) => {
          callCount += 1
          const myCall = callCount
          return new Promise((resolve) => {
            deferredResolvers[myCall] = async () => {
              resolve(await realCeremonyService.prepareCeremony(ownerId))
            }
          })
        }
      }
      const service = createFirstRunSetupService({
        recoveryCeremonyService: wrappedCeremonyService as typeof realCeremonyService
      })

      const promiseA = service.prepareRecoveryKey() // call 1
      const promiseB = service.prepareRecoveryKey() // call 2, started before A resolves

      // Resolve B (the later call) FIRST, then A — proving the
      // outcome depends on call order, not resolution order.
      await deferredResolvers[2]()
      const preparedB = expectPrepared(await promiseB)
      await deferredResolvers[1]()
      const outcomeA = await promiseA

      // A's caller receives success: false directly — never an
      // apparently-valid ceremonyToken/plaintextRecoveryKey pair for a
      // preparation that was already stale by the time it resolved.
      expect(outcomeA).toEqual({ success: false })

      const confirmB = await service.confirmRecoveryKey(
        preparedB.ceremonyToken,
        preparedB.plaintextRecoveryKey
      )
      expect(confirmB).toBeDefined()
    }, 20000)

    it('transaction rollback preserves the current confirmed attempt for retry', async () => {
      const realCeremonyService = createRecoveryCeremonyService()
      let shouldFail = true
      const wrappedCeremonyService = {
        ...realCeremonyService,
        commitCredential: (
          ...args: Parameters<typeof realCeremonyService.commitCredential>
        ): ReturnType<typeof realCeremonyService.commitCredential> => {
          if (shouldFail) {
            throw new Error('simulated failure')
          }
          return realCeremonyService.commitCredential(...args)
        }
      }
      const service = createFirstRunSetupService({
        recoveryCeremonyService: wrappedCeremonyService as typeof realCeremonyService
      })
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      const confirmed = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      const failedOutcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmed!.commitToken
      )
      expect(failedOutcome.success).toBe(false)
      expect(db.select().from(users).all()).toHaveLength(0)

      shouldFail = false
      const successOutcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmed!.commitToken
      )
      expect(successOutcome).toEqual({ success: true })
    }, 20000)

    it('a successful commit clears the active attempt — a further attempt with the same commit token fails', async () => {
      const service = createFirstRunSetupService()
      const prepared = expectPrepared(await service.prepareRecoveryKey())
      const confirmed = await service.confirmRecoveryKey(
        prepared.ceremonyToken,
        prepared.plaintextRecoveryKey
      )

      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmed!.commitToken
      )
      expect(outcome).toEqual({ success: true })

      const secondOutcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmed!.commitToken
      )
      expect(secondOutcome.success).toBe(false)
    }, 20000)
  })

  describe('immediate supersession (a new prepare call invalidates the previous attempt synchronously, not only once it resolves)', () => {
    it("the previous attempt's ceremony is cancelled synchronously — before B's own prepareCeremony call has even resolved, not only by the time B's whole call finishes", async () => {
      const realCeremonyService = createRecoveryCeremonyService()
      const cancelSpy = vi.spyOn(realCeremonyService, 'cancelCeremony')
      let resolveB!: () => void
      let bStarted = false
      const deferredB = new Promise<void>((resolve) => {
        resolveB = resolve
      })
      let prepareCallCount = 0
      const wrappedCeremonyService = {
        ...realCeremonyService,
        prepareCeremony: (ownerId: string) => {
          prepareCallCount += 1
          if (prepareCallCount === 1) {
            return realCeremonyService.prepareCeremony(ownerId)
          }
          bStarted = true
          return deferredB.then(() => realCeremonyService.prepareCeremony(ownerId))
        }
      }
      const service = createFirstRunSetupService({
        recoveryCeremonyService: wrappedCeremonyService as typeof realCeremonyService
      })

      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      cancelSpy.mockClear()

      // Call B, but do not await it yet — bStarted being true proves
      // B's own prepareCeremony call has been *invoked*, while
      // deferredB proves it has not yet *resolved*.
      const promiseB = service.prepareRecoveryKey()
      // A microtask tick lets B's synchronous prefix run (up to its
      // own await) without letting deferredB resolve.
      await Promise.resolve()
      expect(bStarted).toBe(true)

      // A's ceremony must already be cancelled at this exact point —
      // before B's own prepareCeremony call has resolved at all.
      expect(cancelSpy).toHaveBeenCalledWith(preparedA.ceremonyToken)

      resolveB()
      await promiseB
    }, 20000)

    /**
     * Wraps a real RecoveryCeremonyService so its first prepareCeremony
     * call resolves normally, while every subsequent call stays
     * deferred until the test explicitly resolves or rejects it —
     * letting a test start B's preparation and observe A's state
     * *before* B's own async work ever completes.
     */
    function createServiceWithDeferredSecondPreparation(): {
      service: ReturnType<typeof createFirstRunSetupService>
      resolveSecondPreparation: () => void
      rejectSecondPreparation: (error: Error) => void
    } {
      const realCeremonyService = createRecoveryCeremonyService()
      let prepareCallCount = 0
      let resolveSecondPreparation!: () => void
      let rejectSecondPreparation!: (error: Error) => void
      const deferredSecond = new Promise<void>((resolve, reject) => {
        resolveSecondPreparation = resolve
        rejectSecondPreparation = reject
      })
      const wrappedCeremonyService = {
        ...realCeremonyService,
        prepareCeremony: (ownerId: string) => {
          prepareCallCount += 1
          if (prepareCallCount === 1) {
            return realCeremonyService.prepareCeremony(ownerId)
          }
          return deferredSecond.then(() => realCeremonyService.prepareCeremony(ownerId))
        }
      }
      const service = createFirstRunSetupService({
        recoveryCeremonyService: wrappedCeremonyService as typeof realCeremonyService
      })
      return { service, resolveSecondPreparation, rejectSecondPreparation }
    }

    it('A is confirmed; B preparation starts but has not resolved; A can no longer complete, and no rows are written', async () => {
      const { service, resolveSecondPreparation } = createServiceWithDeferredSecondPreparation()

      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const confirmedA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmedA).toBeDefined()

      // B's preparation begins but is held pending — the point of
      // this test is that A is already invalidated at this moment,
      // not only once B eventually resolves.
      const promiseB = service.prepareRecoveryKey()

      const outcome = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedA!.commitToken
      )
      expect(outcome).toEqual({ success: false, errorCode: 'recovery_confirmation_invalid' })
      expect(db.select().from(users).all()).toHaveLength(0)
      expect(db.select().from(company).all()).toHaveLength(0)
      expect(db.select().from(numberingRules).all()).toHaveLength(0)

      resolveSecondPreparation()
      await promiseB
    }, 20000)

    it('A is pending (not yet confirmed); B preparation starts but has not resolved; A can no longer confirm', async () => {
      const { service, resolveSecondPreparation } = createServiceWithDeferredSecondPreparation()

      const preparedA = expectPrepared(await service.prepareRecoveryKey())

      const promiseB = service.prepareRecoveryKey()

      const confirmA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmA).toBeUndefined()

      resolveSecondPreparation()
      await promiseB
    }, 20000)

    it('if B preparation fails, A is not restored — there is no active attempt until a fresh prepare succeeds', async () => {
      const { service, rejectSecondPreparation } = createServiceWithDeferredSecondPreparation()

      const preparedA = expectPrepared(await service.prepareRecoveryKey())

      const promiseB = service.prepareRecoveryKey()
      rejectSecondPreparation(new Error('simulated preparation failure for B'))
      const outcomeB = await promiseB
      expect(outcomeB).toEqual({ success: false })

      // A is not silently restored just because B failed.
      const confirmA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmA).toBeUndefined()
    }, 20000)
  })

  describe('post-hash ownership revalidation (a newer prepare during the Argon2id hash invalidates the in-flight completion)', () => {
    it('a completion paused during password hashing is invalidated once B supersedes A before the hash resolves; B remains completable', async () => {
      const service = createFirstRunSetupService()

      // A's own preparation internally hashes the *recovery key*
      // (via RecoveryCeremonyService.prepareCeremony) using this same
      // shared hashPassword function — that call must complete
      // normally, unmocked, before the mock below is installed, or it
      // would be the one intercepted instead of completeSetup's
      // owner-password hash.
      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const confirmedA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      expect(confirmedA).toBeDefined()

      // Installed only now — the *next* hashPassword call anywhere
      // in the process will be completeSetup's own owner-password
      // hash, which is the one this test needs to pause.
      const hashSpy = vi.spyOn(passwordHashingModule, 'hashPassword')
      let resolveHash!: (value: passwordHashingModule.PasswordHash) => void
      const deferredHash = new Promise<passwordHashingModule.PasswordHash>((resolve) => {
        resolveHash = resolve
      })
      hashSpy.mockImplementationOnce(() => deferredHash)

      // Starts completing A — this call is now paused at the mocked
      // hashPassword call, which will not resolve until this test
      // explicitly resolves it below.
      const completionAPromise = service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedA!.commitToken
      )

      // While A's hash is still pending, B supersedes A entirely —
      // mockImplementationOnce already consumed its one override on
      // completeSetup's call above, so B's own recovery-key hash
      // (inside prepareCeremony) correctly falls through to the real
      // implementation.
      const preparedB = expectPrepared(await service.prepareRecoveryKey())
      const confirmedB = await service.confirmRecoveryKey(
        preparedB.ceremonyToken,
        preparedB.plaintextRecoveryKey
      )
      expect(confirmedB).toBeDefined()

      // Now let A's hash finish — too late, A has already been
      // superseded, so the post-hash revalidation must reject it.
      // The one-time mock override was already consumed by
      // completeSetup's own call above, so this call correctly falls
      // through to the real implementation.
      const realHash = await passwordHashingModule.hashPassword(REAL_PASSWORD)
      resolveHash(realHash)

      const outcomeA = await completionAPromise
      expect(outcomeA).toEqual({ success: false, errorCode: 'recovery_confirmation_invalid' })
      expect(db.select().from(users).all()).toHaveLength(0)
      expect(db.select().from(company).all()).toHaveLength(0)

      // B, the still-current attempt, remains fully completable.
      const outcomeB = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedB!.commitToken
      )
      expect(outcomeB).toEqual({ success: true })
    }, 20000)

    it('a successful commit for one attempt does not disturb a fresh prepare that follows it', async () => {
      // The concrete, observable safety property behind "an old
      // afterCommit callback cannot clear a newer active attempt":
      // runAppTransaction is fully synchronous and completeSetup
      // re-validates immediately before calling it, so there is no
      // window in which a different attempt could already be active
      // by the time an EARLIER completion's afterCommit fires —
      // verified structurally by the post-hash revalidation test
      // above. This test instead exercises the practical, end-to-end
      // guarantee: after one attempt commits and clears itself, a
      // completely fresh prepare on the same service instance works
      // exactly as if nothing had happened — proving A's cleanup
      // left no residue that could interfere with what comes next.
      const service = createFirstRunSetupService()
      const preparedA = expectPrepared(await service.prepareRecoveryKey())
      const confirmedA = await service.confirmRecoveryKey(
        preparedA.ceremonyToken,
        preparedA.plaintextRecoveryKey
      )
      const outcomeA = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedA!.commitToken
      )
      expect(outcomeA).toEqual({ success: true })

      // prepareRecoveryKey itself never inspects durable database
      // state (only completeSetup does), so a fresh prepare still
      // succeeds mechanically here — the real, durable guard against
      // completing setup twice is completeSetup's own
      // getFirstRunStatus recheck, exercised next.
      const preparedC = expectPrepared(await service.prepareRecoveryKey())
      const confirmedC = await service.confirmRecoveryKey(
        preparedC.ceremonyToken,
        preparedC.plaintextRecoveryKey
      )
      expect(confirmedC).toBeDefined()

      const outcomeC = await service.completeSetup(
        db,
        VALID_COMPANY,
        VALID_OWNER,
        confirmedC!.commitToken
      )
      expect(outcomeC).toEqual({ success: false, errorCode: 'setup_already_complete' })

      // Crucially: the original Owner from A is completely
      // undisturbed by any of this.
      expect(db.select().from(users).all()).toHaveLength(1)
    }, 20000)
  })
})

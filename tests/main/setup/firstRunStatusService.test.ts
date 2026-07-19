import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import { getFirstRunStatus } from '../../../src/main/setup/firstRunStatusService'
import { createFirstRunSetupService } from '../../../src/main/setup/firstRunSetupService'
import { currencies, numberingRules, roles, userRoles } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'
const VALID_COMPANY = { name: 'Fixture Co', address: 'Addr', contactDetails: 'contact@example.com' }
const VALID_OWNER = {
  displayName: 'Ben',
  loginIdentifier: 'ben',
  password: REAL_PASSWORD,
  passwordConfirmation: REAL_PASSWORD
}

describe('firstRunStatusService.getFirstRunStatus', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-first-run-status')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  async function completeSetupNormally(): Promise<void> {
    const service = createFirstRunSetupService()
    const prepared = await service.prepareRecoveryKey()
    if (!prepared.success) {
      throw new Error(
        'completeSetupNormally helper failed: prepareRecoveryKey returned success:false'
      )
    }
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
    if (!outcome.success) {
      throw new Error('completeSetupNormally helper failed: ' + outcome.errorCode)
    }
  }

  it('a fresh, approved Slice 7 database reports setup_required', () => {
    expect(getFirstRunStatus(db)).toEqual({ status: 'setup_required' })
  })

  it('reference currencies and the four fixed roles do not prevent setup_required', () => {
    const currencyCount = db.select().from(currencies).all().length
    const roleCount = db.select().from(roles).all().length
    expect(currencyCount).toBeGreaterThan(0)
    expect(roleCount).toBe(4)

    expect(getFirstRunStatus(db)).toEqual({ status: 'setup_required' })
  })

  it('a fully completed setup reports setup_complete', async () => {
    await completeSetupNormally()
    expect(getFirstRunStatus(db)).toEqual({ status: 'setup_complete' })
  }, 20000)

  it('a restart (fresh connection to the same file) preserves the completed state', async () => {
    await completeSetupNormally()
    rawDb.close()

    const restartedRawDb = createDatabaseConnection(dbPath)
    const restartedDb = drizzle<Record<string, never>>(restartedRawDb)
    expect(getFirstRunStatus(restartedDb)).toEqual({ status: 'setup_complete' })
    restartedRawDb.close()

    // Reopen the original handle so afterEach's rawDb.close() doesn't
    // operate on an already-closed connection.
    rawDb = createDatabaseConnection(dbPath)
  }, 20000)

  it('normal startup (migrations + reference data + roles only) does not seed a user', () => {
    const userCount = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
    expect(userCount).toBe(0)
    expect(getFirstRunStatus(db)).toEqual({ status: 'setup_required' })
  })

  it('getFirstRunStatus accepts no renderer-supplied parameter at all — only a database handle', () => {
    expect(getFirstRunStatus.length).toBe(1)
  })

  describe('pristine vs. partial zero-user state', () => {
    it('a company row alone (zero users) reports inconsistent_state, not setup_required', () => {
      createCompany(db, { ...VALID_COMPANY, currencyId: 'currency_usd' }, new Date())

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('numbering_rules alone, with no company row (zero users), reports inconsistent_state', () => {
      // numbering_rules.company_id is itself a foreign key to
      // company.id, so even constructing "numbering without a company"
      // requires disabling FK enforcement — this state is doubly
      // protected by the schema, and this test proves the application-
      // level check catches it too, defensively.
      rawDb.pragma('foreign_keys = OFF')
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO numbering_rules (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at) VALUES ('nr1', 'primary_company', 'invoice', 'INV', 6, 'yearly', 0, NULL, ?, ?)"
        )
        .run(now, now)
      rawDb.pragma('foreign_keys = ON')

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('company plus numbering rules but no user reports inconsistent_state', () => {
      createCompany(db, { ...VALID_COMPANY, currencyId: 'currency_usd' }, new Date())
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO numbering_rules (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at) VALUES ('nr1', 'primary_company', 'invoice', 'INV', 6, 'yearly', 0, NULL, ?, ?)"
        )
        .run(now, now)

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('a stray user_roles row with zero real users reports inconsistent_state', () => {
      // user_roles.user_id is a foreign key to users.id, so this also
      // requires disabling FK enforcement to construct — same
      // defensive reasoning as the orphaned-credential check.
      rawDb.pragma('foreign_keys = OFF')
      rawDb
        .prepare(
          "INSERT INTO user_roles (user_id, role_id, created_at) VALUES ('user_does_not_exist', 'role_owner', ?)"
        )
        .run(Date.now())
      rawDb.pragma('foreign_keys = ON')

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('a stray recovery-credential row with zero real users reports inconsistent_state', () => {
      rawDb.pragma('foreign_keys = OFF')
      rawDb
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1', 'user_does_not_exist', 'hash', 1, 1, ?)"
        )
        .run(Date.now())
      rawDb.pragma('foreign_keys = ON')

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })
  })

  describe('setup-complete Owner invariant is compatible with future (Slice 9) users', () => {
    it('completed setup with exactly one Owner reports setup_complete', async () => {
      await completeSetupNormally()
      expect(getFirstRunStatus(db)).toEqual({ status: 'setup_complete' })
    }, 20000)

    it('adding one normal non-Owner user afterward still reports setup_complete', async () => {
      await completeSetupNormally()

      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'employee1', displayName: 'Employee One', passwordHash })
      )
      // Deliberately no role assignment at all — Slice 9 territory,
      // but even an unassigned user must not break this invariant.

      expect(getFirstRunStatus(db)).toEqual({ status: 'setup_complete' })
    }, 20000)

    it('adding several non-Owner users, some with non-Owner roles, still reports setup_complete', async () => {
      await completeSetupNormally()

      const passwordHash = await hashPassword(REAL_PASSWORD)
      const now = new Date()
      const finance = db.transaction((tx) =>
        createUser(tx, {
          loginIdentifier: 'financeuser',
          displayName: 'Finance User',
          passwordHash
        })
      )
      const ops = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'opsuser', displayName: 'Ops User', passwordHash })
      )
      db.transaction((tx) =>
        createUser(tx, {
          loginIdentifier: 'unassigned',
          displayName: 'Unassigned User',
          passwordHash
        })
      )
      db.insert(userRoles)
        .values({ userId: finance.id, roleId: 'role_finance', createdAt: now })
        .run()
      db.insert(userRoles)
        .values({ userId: ops.id, roleId: 'role_operations', createdAt: now })
        .run()

      expect(getFirstRunStatus(db)).toEqual({ status: 'setup_complete' })
    }, 20000)

    it('adding a second role_owner assignment reports inconsistent_state', async () => {
      await completeSetupNormally()

      const passwordHash = await hashPassword(REAL_PASSWORD)
      const second = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'seconduser', displayName: 'Second User', passwordHash })
      )
      db.insert(userRoles)
        .values({ userId: second.id, roleId: 'role_owner', createdAt: new Date() })
        .run()

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    }, 20000)
  })

  describe('other inconsistent_state detection', () => {
    it('a user exists without a role_owner assignment', async () => {
      createCompany(db, { ...VALID_COMPANY, currencyId: 'currency_usd' }, new Date())
      const passwordHash = await hashPassword(REAL_PASSWORD)
      db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    }, 20000)

    it('a role_owner assignment exists without an active recovery credential', async () => {
      createCompany(db, { ...VALID_COMPANY, currencyId: 'currency_usd' }, new Date())
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const owner = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )
      db.insert(userRoles)
        .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
        .run()

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    }, 20000)

    it('multiple initial Owner candidates exist where the invariant requires one', async () => {
      const passwordHash = await hashPassword(REAL_PASSWORD)
      createCompany(db, { ...VALID_COMPANY, currencyId: 'currency_usd' }, new Date())
      const first = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'first', displayName: 'First', passwordHash })
      )
      const second = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'second', displayName: 'Second', passwordHash })
      )
      const now = new Date()
      db.insert(userRoles).values({ userId: first.id, roleId: 'role_owner', createdAt: now }).run()
      db.insert(userRoles).values({ userId: second.id, roleId: 'role_owner', createdAt: now }).run()

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    }, 20000)

    it('a recovery credential exists without its user (orphaned, bypassing the FK defensively)', () => {
      rawDb.pragma('foreign_keys = OFF')
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1', 'user_does_not_exist', 'hash', 1, 1, ?)"
        )
        .run(now)
      rawDb.pragma('foreign_keys = ON')

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('an Owner exists but the company profile is missing', () => {
      rawDb.pragma('foreign_keys = OFF')
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('user_orphan_owner', 'primary_company', 'ben', 'Ben', '$argon2id$v=19$m=65536,t=3,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ?, ?, ?)"
        )
        .run(now, now, now)
      rawDb
        .prepare(
          "INSERT INTO user_roles (user_id, role_id, created_at) VALUES ('user_orphan_owner', 'role_owner', ?)"
        )
        .run(now)
      rawDb
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1', 'user_orphan_owner', 'hash', 1, 1, ?)"
        )
        .run(now)
      rawDb.pragma('foreign_keys = ON')

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    })

    it('an Owner exists but a numbering_rules row is missing', async () => {
      await completeSetupNormally()
      expect(getFirstRunStatus(db)).toEqual({ status: 'setup_complete' })

      // Remove one numbering rule directly to simulate corruption —
      // no service in this codebase does this under normal operation.
      db.delete(numberingRules).where(eq(numberingRules.documentTypeKey, 'invoice')).run()

      const result = getFirstRunStatus(db)
      expect(result.status).toBe('inconsistent_state')
    }, 20000)
  })
})

import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import * as userService from '../../../src/main/auth/userService'
import {
  changePassword,
  createUser,
  deactivateUser,
  getUserAuthRecordByLoginIdentifier,
  getUserById,
  getUserByLoginIdentifier,
  reactivateUser,
  setLoginLockoutState,
  UserServiceError
} from '../../../src/main/auth/userService'
import {
  hashPassword,
  PasswordHashValidationError,
  verifyPassword
} from '../../../src/main/auth/passwordHashing'
import { AuthValidationError } from '../../../src/main/auth/authValidation'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

async function createTestUser(
  db: AppDb,
  overrides: { loginIdentifier?: string; displayName?: string; password?: string } = {}
) {
  const passwordHash = await hashPassword(overrides.password ?? 'a-valid-password-123')
  return db.transaction((tx) =>
    createUser(tx, {
      loginIdentifier: overrides.loginIdentifier ?? 'ben',
      displayName: overrides.displayName ?? 'Ben',
      passwordHash
    })
  )
}

describe('userService', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    dir = createTempDir('ledgerpage-user-service')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  describe('before a company exists', () => {
    it('createUser throws a clear, documented error rather than a raw FK failure', async () => {
      const passwordHash = await hashPassword('a-valid-password-123')
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
        )
      ).toThrow(UserServiceError)
    })
  })

  describe('once a company exists', () => {
    beforeEach(() => {
      createCompany(db, {
        name: 'Fixture Co',
        address: 'Addr',
        contactDetails: 'contact@example.com',
        currencyId: 'currency_usd'
      })
    })

    it('creates a user successfully', async () => {
      const created = await createTestUser(db)
      expect(created.loginIdentifier).toBe('ben')
      expect(created.isActive).toBe(true)
      expect(created.failedLoginCount).toBe(0)
      expect(created.lockedUntil).toBeNull()
    })

    it('the created user object contains no passwordHash field at all', async () => {
      const created = await createTestUser(db)
      expect('passwordHash' in created).toBe(false)
    })

    it('normalizes the login identifier deterministically (case/whitespace-insensitive lookup)', async () => {
      const created = await createTestUser(db, { loginIdentifier: '  Ben  ' })
      expect(created.loginIdentifier).toBe('ben')

      expect(getUserByLoginIdentifier(db, 'BEN')?.id).toBe(created.id)
      expect(getUserByLoginIdentifier(db, ' ben ')?.id).toBe(created.id)
    })

    it('rejects a duplicate normalized login identifier', async () => {
      await createTestUser(db, { loginIdentifier: 'ben' })
      const passwordHash = await hashPassword('another-valid-password')
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'BEN', displayName: 'Ben Two', passwordHash })
        )
      ).toThrow(UserServiceError)
    })

    it('rejects an empty passwordHash', async () => {
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash: '' })
        )
      ).toThrow(PasswordHashValidationError)
    })

    it('rejects a login identifier that is too short', async () => {
      const passwordHash = await hashPassword('a-valid-password-123')
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'ab', displayName: 'Ben', passwordHash })
        )
      ).toThrow(AuthValidationError)
    })

    it('rejects a login identifier containing whitespace', async () => {
      const passwordHash = await hashPassword('a-valid-password-123')
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'ben smith', displayName: 'Ben', passwordHash })
        )
      ).toThrow(AuthValidationError)
    })

    it('rejects a whitespace-only display name', async () => {
      const passwordHash = await hashPassword('a-valid-password-123')
      expect(() =>
        db.transaction((tx) =>
          createUser(tx, { loginIdentifier: 'ben', displayName: '   ', passwordHash })
        )
      ).toThrow(AuthValidationError)
    })

    it('getUserById returns a safe record with no passwordHash', async () => {
      const created = await createTestUser(db)
      const found = getUserById(db, created.id)
      expect(found).toBeDefined()
      expect('passwordHash' in (found as object)).toBe(false)
    })

    it('getUserAuthRecordByLoginIdentifier is the only lookup that returns passwordHash', async () => {
      await createTestUser(db, { loginIdentifier: 'ben', password: 'my-secret-password-1' })
      const authRecord = getUserAuthRecordByLoginIdentifier(db, 'ben')
      expect(authRecord?.passwordHash).toBeDefined()
      await expect(verifyPassword('my-secret-password-1', authRecord!.passwordHash)).resolves.toBe(
        true
      )
    })

    it('deactivateUser blocks the isActive flag and reactivateUser restores it', async () => {
      const created = await createTestUser(db)
      const deactivated = deactivateUser(db, created.id)
      expect(deactivated.isActive).toBe(false)

      const reactivated = reactivateUser(db, created.id)
      expect(reactivated.isActive).toBe(true)
    })

    it('changePassword updates password_hash and advances password_changed_at', async () => {
      const created = await createTestUser(db, { password: 'original-password-1' })
      const before = getUserAuthRecordByLoginIdentifier(db, created.loginIdentifier)!

      const updated = await changePassword(
        db,
        created.id,
        'brand-new-password-2',
        new Date(before.updatedAt.getTime() + 10000)
      )

      const after = getUserAuthRecordByLoginIdentifier(db, created.loginIdentifier)!
      expect(after.passwordHash).not.toBe(before.passwordHash)
      await expect(verifyPassword('brand-new-password-2', after.passwordHash)).resolves.toBe(true)
      await expect(verifyPassword('original-password-1', after.passwordHash)).resolves.toBe(false)
      expect(updated.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime())
    }, 20000)

    it('setLoginLockoutState is a mechanical setter with no policy of its own', async () => {
      const created = await createTestUser(db)
      const locked = new Date(Date.now() + 60000)

      const updated = setLoginLockoutState(db, created.id, {
        failedLoginCount: 3,
        lockedUntil: locked
      })

      expect(updated.failedLoginCount).toBe(3)
      expect(updated.lockedUntil?.getTime()).toBe(locked.getTime())
    })

    describe('password hash validation at the persistence boundary (fix 3)', () => {
      it('createUser rejects plaintext passed as a hash', () => {
        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: 'my-plaintext-password-not-a-hash'
            })
          )
        ).toThrow(PasswordHashValidationError)
      })

      it('createUser rejects a malformed PHC string', () => {
        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: '$argon2id$this-is-not-well-formed'
            })
          )
        ).toThrow(PasswordHashValidationError)
      })

      it('createUser rejects an argon2i hash', async () => {
        const realHash = await hashPassword('a-valid-password-123')
        const argon2iHash = realHash.replace('$argon2id$', '$argon2i$')

        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: argon2iHash
            })
          )
        ).toThrow(PasswordHashValidationError)
      })

      it('createUser rejects an argon2d hash', async () => {
        const realHash = await hashPassword('a-valid-password-123')
        const argon2dHash = realHash.replace('$argon2id$', '$argon2d$')

        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: argon2dHash
            })
          )
        ).toThrow(PasswordHashValidationError)
      })

      it('createUser rejects an Argon2id hash using outdated/wrong parameters', async () => {
        const realHash = await hashPassword('a-valid-password-123')
        const wrongParamsHash = realHash.replace('m=65536,t=3,p=1', 'm=4096,t=1,p=1')

        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: wrongParamsHash
            })
          )
        ).toThrow(PasswordHashValidationError)
      })

      it('createUser accepts a hash actually returned by hashPassword', async () => {
        const realHash = await hashPassword('a-valid-password-123')

        expect(() =>
          db.transaction((tx) =>
            createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash: realHash })
          )
        ).not.toThrow()
      })

      it('no user row is inserted after a rejected passwordHash', () => {
        expect(() =>
          db.transaction((tx) =>
            createUser(tx, {
              loginIdentifier: 'ben',
              displayName: 'Ben',
              passwordHash: 'plaintext'
            })
          )
        ).toThrow(PasswordHashValidationError)

        const count = (rawDb.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c
        expect(count).toBe(0)
      })

      it('changePassword also produces a hash that passes the same validation gate', async () => {
        const created = await createTestUser(db)
        const updated = await changePassword(db, created.id, 'brand-new-password-2')
        const authRecord = getUserAuthRecordByLoginIdentifier(db, updated.loginIdentifier)!
        expect(authRecord.passwordHash).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/)
      })
    })
  })

  it('no public function exposes an arbitrary company id', () => {
    const exportedFunctionNames = Object.keys(userService).filter((key) => {
      const value = (userService as Record<string, unknown>)[key]
      return (
        typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
      )
    })

    expect(exportedFunctionNames.sort()).toEqual(
      [
        'changePassword',
        'createUser',
        'deactivateUser',
        'getUserAuthRecordByLoginIdentifier',
        'getUserById',
        'getUserByLoginIdentifier',
        'reactivateUser',
        'setLoginLockoutState'
      ].sort()
    )
  })
})

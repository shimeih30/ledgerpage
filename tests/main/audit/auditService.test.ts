import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import { taxCodes } from '../../../src/main/db/schema'
import {
  record,
  listEntries,
  AuditServiceError,
  type AuditCursor
} from '../../../src/main/audit/auditService'
import * as auditServiceModule from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

describe('auditService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let ownerId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-audit-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
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
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const owner = db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
    )
    ownerId = owner.id
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function rawRows(): { entityId: string; action: string; changedFields: string | null }[] {
    return rawDb
      .prepare(
        'SELECT entity_id as entityId, action, changed_fields as changedFields FROM audit_log_entries'
      )
      .all() as { entityId: string; action: string; changedFields: string | null }[]
  }

  /**
   * Inserts a row directly via raw SQL, bypassing record() entirely —
   * record() always produces well-formed changed_fields JSON, so the
   * only way to exercise listEntries' own runtime validation of a
   * stored (and therefore untrusted-by-the-time-it's-read) column is
   * to construct a row record() itself could never have written.
   */
  function insertRawAuditRow(changedFields: string | null): void {
    rawDb
      .prepare(
        `INSERT INTO audit_log_entries
         (id, entity_type, entity_id, entity_label, action, changed_fields, actor_type, user_id, company_id, occurred_at)
         VALUES ('raw_test_row', 'x', '1', 'x', 'update', ?, 'system', NULL, NULL, ?)`
      )
      .run(changedFields, Date.now())
  }

  describe('append-only surface', () => {
    it('exports no update/delete mutation API', () => {
      const exportedFunctionNames = Object.keys(auditServiceModule).filter((key) => {
        const value = (auditServiceModule as Record<string, unknown>)[key]
        return (
          typeof value === 'function' && !/^class\s/.test(Function.prototype.toString.call(value))
        )
      })
      expect(exportedFunctionNames.sort()).toEqual(['listEntries', 'record'].sort())
    })

    it('calling record() twice for the same entityId produces two separate rows, never an update to the first', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: 'same-id',
          entityLabel: 'first',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { value: 1 }
        })
      })
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: 'same-id',
          entityLabel: 'second',
          action: 'update',
          actor: { type: 'system' },
          companyId: null,
          before: { value: 1 },
          after: { value: 2 }
        })
      })

      // Genuinely append-only behavior, not merely an empty export
      // list: the database itself now holds two distinct rows for
      // the same entityId, rather than one row that was overwritten.
      const rows = rawRows().filter((r) => r.entityId === 'same-id')
      expect(rows).toHaveLength(2)
      expect(rows.map((r) => r.action)).toEqual(['create', 'update'])
    })
  })

  describe('diff shape', () => {
    it('create records null -> value for every field', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1, b: 'text', c: true }
        })
      })
      const result = listEntries(db)
      expect(result.entries[0].changedFields).toEqual({
        a: { old: null, new: 1 },
        b: { old: null, new: 'text' },
        c: { old: null, new: true }
      })
    })

    it('update includes only fields that actually changed', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'update',
          actor: { type: 'system' },
          companyId: null,
          before: { name: 'Old', category: 'standard', unrelated: 'same' },
          after: { name: 'New', category: 'standard', unrelated: 'same' }
        })
      })
      const result = listEntries(db)
      expect(result.entries[0].changedFields).toEqual({ name: { old: 'Old', new: 'New' } })
    })

    it('deactivate/reactivate record the isActive transition explicitly', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'deactivate',
          actor: { type: 'system' },
          companyId: null,
          before: { isActive: true },
          after: { isActive: false }
        })
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'reactivate',
          actor: { type: 'system' },
          companyId: null,
          before: { isActive: false },
          after: { isActive: true }
        })
      })
      const result = listEntries(db)
      // Found by action rather than relied-on array position: both
      // records happen inside the same transaction and can share the
      // exact same millisecond occurredAt value, in which case the
      // id-based DESC tiebreaker's order is not chronological — a
      // flaky assumption to avoid here, unrelated to what this test
      // actually verifies.
      const deactivateEntry = result.entries.find((e) => e.action === 'deactivate')!
      const reactivateEntry = result.entries.find((e) => e.action === 'reactivate')!
      expect(deactivateEntry.changedFields).toEqual({ isActive: { old: true, new: false } })
      expect(reactivateEntry.changedFields).toEqual({ isActive: { old: false, new: true } })
    })

    it('a true no-op (identical before/after) creates no row for update/deactivate/reactivate', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'update',
          actor: { type: 'system' },
          companyId: null,
          before: { name: 'Same', category: 'standard' },
          after: { name: 'Same', category: 'standard' }
        })
        record(tx, {
          entityType: 'x',
          entityId: '2',
          entityLabel: 'x',
          action: 'deactivate',
          actor: { type: 'system' },
          companyId: null,
          before: { isActive: false },
          after: { isActive: false }
        })
      })
      expect(listEntries(db).entries).toHaveLength(0)
    })

    it('a create with an empty after object still writes a row (create is never treated as a no-op)', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: {}
        })
      })
      expect(listEntries(db).entries).toHaveLength(1)
    })
  })

  describe('recursive redaction', () => {
    it('redacts every required secret-key pattern, at any nesting depth, in objects and arrays', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: {
            password: 'secret-value-1',
            passphrase: 'secret-value-2',
            passwordHash: 'secret-value-3',
            recoveryKeyHash: 'secret-value-4',
            secretToken: 'secret-value-5',
            apiKey: 'secret-value-6',
            api_key: 'secret-value-7',
            privateKey: 'secret-value-8',
            authorizationHeader: 'secret-value-9',
            sessionCookie: 'secret-value-10',
            otpCode: 'secret-value-11',
            passwordSalt: 'secret-value-12',
            credentialId: 'secret-value-13',
            nested: { deeplyNestedSecret: { token: 'secret-value-14' } },
            arrayOfSecrets: [{ apiKey: 'secret-value-15' }, 'not-an-object'],
            visibleField: 'this-should-stay-visible'
          }
        })
      })
      const serialized = JSON.stringify(listEntries(db).entries)
      for (let i = 1; i <= 15; i++) {
        expect(serialized).not.toContain(`secret-value-${i}`)
      }
      expect(serialized).toContain('this-should-stay-visible')
      expect(serialized).toContain('[redacted]')
    })

    it('redacts both the old and new value of a changed secret-like field', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'update',
          actor: { type: 'system' },
          companyId: null,
          before: { passwordHash: 'old-secret-value' },
          after: { passwordHash: 'new-secret-value' }
        })
      })
      const entry = listEntries(db).entries[0]
      expect(entry.changedFields).toEqual({
        passwordHash: { old: '[redacted]', new: '[redacted]' }
      })
    })

    it('does not redact a key that merely contains an unrelated substring resembling a pattern', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { displayName: 'visible-name', loginIdentifier: 'visible-login' }
        })
      })
      const serialized = JSON.stringify(listEntries(db).entries)
      expect(serialized).toContain('visible-name')
      expect(serialized).toContain('visible-login')
    })
  })

  describe('actors', () => {
    it('an explicit system actor is stored with actorType system, a null userId, and actorLabel "System"', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      const entry = listEntries(db).entries[0]
      expect(entry.actorType).toBe('system')
      expect(entry.userId).toBeNull()
      expect(entry.actorLabel).toBe('System')
    })

    it('an explicit user actor is stored with actorType user, that exact userId, and actorLabel equal to the user\u2019s displayName', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'user', userId: ownerId },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      const entry = listEntries(db).entries[0]
      expect(entry.actorType).toBe('user')
      expect(entry.userId).toBe(ownerId)
      expect(entry.actorLabel).toBe('Ben')
    })

    it('actorLabel reflects the user\u2019s current displayName, resolved fresh on every list call rather than cached at write time', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'user', userId: ownerId },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      // A later, real display-name change (not part of this slice's own
      // surface, so applied directly) must be reflected immediately,
      // proving actorLabel is never a value captured once at write time.
      rawDb.prepare('UPDATE users SET display_name = ? WHERE id = ?').run('Ben Renamed', ownerId)

      const entry = listEntries(db).entries[0]
      expect(entry.actorLabel).toBe('Ben Renamed')
    })

    it('falls back to "Unknown user" for a user actor whose referenced user row is defensively absent', () => {
      // Simulates the expected-unreachable case the ON DELETE RESTRICT
      // foreign key is specifically designed to prevent in practice —
      // foreign key enforcement is disabled for this one connection,
      // for this one test only, purely to exercise the defensive
      // fallback branch of actorLabel's own resolution logic.
      rawDb.pragma('foreign_keys = OFF')
      rawDb
        .prepare(
          `INSERT INTO audit_log_entries
           (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
           VALUES ('orphan_actor_row', 'x', '1', 'x', 'create', 'user', 'user_does_not_exist', NULL, ?)`
        )
        .run(Date.now())

      const entry = listEntries(db).entries[0]
      expect(entry.actorType).toBe('user')
      expect(entry.userId).toBe('user_does_not_exist')
      expect(entry.actorLabel).toBe('Unknown user')
    })

    it('a user actor referencing a nonexistent userId is rejected by the FK constraint', () => {
      expect(() => {
        db.transaction((tx) => {
          record(tx, {
            entityType: 'x',
            entityId: '1',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'user', userId: 'user_does_not_exist' },
            companyId: null,
            before: null,
            after: { a: 1 }
          })
        })
      }).toThrow()
      expect(listEntries(db).entries).toHaveLength(0)
    })

    it('the actor-user-consistency CHECK constraint rejects a system actor with a non-null user_id, bypassing record()', () => {
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad1', 'x', '1', 'x', 'create', 'system', ?, NULL, ?)`
          )
          .run(ownerId, Date.now())
      }).toThrow()
    })

    it('the actor-user-consistency CHECK constraint rejects a user actor with a null user_id, bypassing record()', () => {
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad2', 'x', '1', 'x', 'create', 'user', NULL, NULL, ?)`
          )
          .run(Date.now())
      }).toThrow()
    })

    it('the action CHECK constraint rejects a value outside the fixed set, bypassing record()', () => {
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad3', 'x', '1', 'x', 'delete', 'system', NULL, NULL, ?)`
          )
          .run(Date.now())
      }).toThrow()
    })
  })

  describe('atomicity', () => {
    it('an audit insertion failure rolls back the associated business mutation in the same transaction', () => {
      expect(() => {
        db.transaction((tx) => {
          tx.insert(taxCodes)
            .values({
              id: 'tc_rollback',
              companyId: 'primary_company',
              code: 'ROLLBACK',
              name: 'Rollback',
              category: 'standard',
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date()
            })
            .run()

          record(tx, {
            entityType: 'tax_code',
            entityId: 'tc_rollback',
            entityLabel: 'Rollback',
            // @ts-expect-error deliberately invalid to trigger the CHECK constraint and roll back
            action: 'not_a_real_action',
            actor: { type: 'system' },
            companyId: 'primary_company',
            before: null,
            after: { code: 'ROLLBACK' }
          })
        })
      }).toThrow()

      const taxCodeRow = rawDb.prepare("SELECT * FROM tax_codes WHERE id = 'tc_rollback'").get()
      expect(taxCodeRow).toBeUndefined()
      expect(listEntries(db).entries).toHaveLength(0)
    })
  })

  describe('cursor pagination', () => {
    function seedEntries(count: number, occurredAtBase: Date): void {
      db.transaction((tx) => {
        for (let i = 0; i < count; i++) {
          record(
            tx,
            {
              entityType: 'x',
              entityId: String(i),
              entityLabel: `x${String(i)}`,
              action: 'create',
              actor: { type: 'system' },
              companyId: null,
              before: null,
              after: { a: i }
            },
            occurredAtBase
          )
        }
      })
    }

    it('paginates correctly when multiple entries share the exact same occurredAt timestamp', () => {
      const sameInstant = new Date('2026-01-01T00:00:00.000Z')
      seedEntries(5, sameInstant)

      const page1 = listEntries(db, { limit: 2 })
      expect(page1.entries).toHaveLength(2)
      expect(page1.nextCursor).not.toBeNull()

      const page2 = listEntries(db, { limit: 2, cursor: page1.nextCursor as AuditCursor })
      expect(page2.entries).toHaveLength(2)

      const page3 = listEntries(db, { limit: 2, cursor: page2.nextCursor as AuditCursor })
      expect(page3.entries).toHaveLength(1)
      expect(page3.nextCursor).toBeNull()

      // Stable, gap-free, non-duplicated across pages despite every
      // row sharing one identical occurredAt value.
      const allIds = [...page1.entries, ...page2.entries, ...page3.entries]
        .map((e) => e.entityId)
        .sort()
      expect(allIds).toEqual(['0', '1', '2', '3', '4'])
    })

    it('orders by occurred_at DESC, id DESC — newest first, stable', () => {
      db.transaction((tx) => {
        record(
          tx,
          {
            entityType: 'x',
            entityId: 'older',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: 1 }
          },
          new Date('2026-01-01T00:00:00.000Z')
        )
        record(
          tx,
          {
            entityType: 'x',
            entityId: 'newer',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: 2 }
          },
          new Date('2026-01-02T00:00:00.000Z')
        )
      })
      const result = listEntries(db)
      expect(result.entries.map((e) => e.entityId)).toEqual(['newer', 'older'])
    })

    it('uses the default limit when none is specified', () => {
      seedEntries(60, new Date())
      const result = listEntries(db)
      expect(result.entries).toHaveLength(50)
      expect(result.nextCursor).not.toBeNull()
    })

    it('hard-clamps the limit to the maximum regardless of what is requested', () => {
      seedEntries(250, new Date())
      const result = listEntries(db, { limit: 999999 })
      expect(result.entries.length).toBeLessThanOrEqual(200)
    })

    it('filters by entityType', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'tax_code',
          entityId: '1',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
        record(tx, {
          entityType: 'user',
          entityId: '2',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      const result = listEntries(db, { entityType: 'tax_code' })
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].entityType).toBe('tax_code')
    })

    it('filters by an occurredAt date range', () => {
      db.transaction((tx) => {
        record(
          tx,
          {
            entityType: 'x',
            entityId: 'early',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: 1 }
          },
          new Date('2026-01-01T00:00:00.000Z')
        )
        record(
          tx,
          {
            entityType: 'x',
            entityId: 'middle',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: 2 }
          },
          new Date('2026-06-01T00:00:00.000Z')
        )
        record(
          tx,
          {
            entityType: 'x',
            entityId: 'late',
            entityLabel: 'x',
            action: 'create',
            actor: { type: 'system' },
            companyId: null,
            before: null,
            after: { a: 3 }
          },
          new Date('2026-12-01T00:00:00.000Z')
        )
      })
      const result = listEntries(db, {
        fromOccurredAt: new Date('2026-03-01T00:00:00.000Z').getTime(),
        toOccurredAt: new Date('2026-09-01T00:00:00.000Z').getTime()
      })
      expect(result.entries.map((e) => e.entityId)).toEqual(['middle'])
    })
  })

  describe('changed_fields runtime validation on read', () => {
    it('fails closed on invalid JSON', () => {
      insertRawAuditRow('{not valid json')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on a top-level array', () => {
      insertRawAuditRow('[1, 2, 3]')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on a top-level null', () => {
      insertRawAuditRow('null')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on a top-level primitive (string)', () => {
      insertRawAuditRow('"just a string"')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on a top-level primitive (number)', () => {
      insertRawAuditRow('42')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed when a field value is not an object', () => {
      insertRawAuditRow('{"name": "just a string, not {old,new}"}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed when a field value is an array instead of an object', () => {
      insertRawAuditRow('{"name": ["old-value", "new-value"]}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed when a field-change object is missing "new"', () => {
      insertRawAuditRow('{"name": {"old": "a"}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed when a field-change object is missing "old"', () => {
      insertRawAuditRow('{"name": {"new": "b"}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed when a field-change object is entirely empty', () => {
      insertRawAuditRow('{"name": {}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    describe('strict field-change shape (exactly old and new, nothing else)', () => {
      it('{ old, new } in that order passes', () => {
        insertRawAuditRow('{"name": {"old": 1, "new": 2}}')
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual({ name: { old: 1, new: 2 } })
      })

      it('{ new, old } in reverse order still passes -- key order does not matter', () => {
        insertRawAuditRow('{"name": {"new": 2, "old": 1}}')
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual({ name: { old: 1, new: 2 } })
      })

      it('missing old fails', () => {
        insertRawAuditRow('{"name": {"new": 2}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('missing new fails', () => {
        insertRawAuditRow('{"name": {"old": 1}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('an additional safe sibling key fails -- it is never silently dropped', () => {
        insertRawAuditRow('{"name": {"old": 1, "new": 2, "reason": "a completely safe string"}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('several additional sibling keys fail', () => {
        insertRawAuditRow(
          '{"name": {"old": 1, "new": 2, "note": "safe", "timestamp": 123, "extra": true}}'
        )
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('a safe nested object inside old and new still passes, with exactly old/new at the top', () => {
        const payload = {
          settings: {
            old: { theme: 'light', level: 1 },
            new: { theme: 'dark', level: 2, tags: ['a', 'b'] }
          }
        }
        insertRawAuditRow(JSON.stringify(payload))
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual(payload)
      })

      it('a safe array inside old and new still passes, with exactly old/new at the top', () => {
        const payload = {
          roleAssignments: {
            old: [],
            new: [{ userId: 'u1', roleId: 'role_finance' }]
          }
        }
        insertRawAuditRow(JSON.stringify(payload))
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual(payload)
      })
    })

    it('fails closed on an unsafe top-level key: __proto__', () => {
      insertRawAuditRow('{"__proto__": {"old": 1, "new": 2}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on an unsafe top-level key: prototype', () => {
      insertRawAuditRow('{"prototype": {"old": 1, "new": 2}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('fails closed on an unsafe top-level key: constructor', () => {
      insertRawAuditRow('{"constructor": {"old": 1, "new": 2}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('never mutates Object.prototype even when an unsafe key is present in the stored JSON', () => {
      insertRawAuditRow('{"__proto__": {"old": null, "new": {"polluted": true}}}')
      expect(() => listEntries(db)).toThrow(AuditServiceError)
      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    })

    it('never returns a partially parsed entry: a malformed row fails the whole request, not just that row', () => {
      db.transaction((tx) => {
        record(tx, {
          entityType: 'x',
          entityId: 'valid-entry',
          entityLabel: 'x',
          action: 'create',
          actor: { type: 'system' },
          companyId: null,
          before: null,
          after: { a: 1 }
        })
      })
      insertRawAuditRow('{not valid json')

      // The one malformed row must not be silently skipped while the
      // otherwise-valid row is still returned -- the whole call fails.
      expect(() => listEntries(db)).toThrow(AuditServiceError)
    })

    it('a well-formed row with nested old/new object values still parses successfully', () => {
      insertRawAuditRow(
        JSON.stringify({
          metadata: { old: { count: 1 }, new: { count: 2, extra: ['a', 'b'] } },
          simpleField: { old: null, new: 'value' }
        })
      )
      const result = listEntries(db)
      expect(result.entries).toHaveLength(1)
      expect(result.entries[0].changedFields).toEqual({
        metadata: { old: { count: 1 }, new: { count: 2, extra: ['a', 'b'] } },
        simpleField: { old: null, new: 'value' }
      })
    })

    describe('recursive unsafe-key rejection', () => {
      it('fails closed on an unsafe key directly inside a field-change object (a sibling of old/new)', () => {
        insertRawAuditRow('{"name": {"old": 1, "new": 2, "__proto__": {"x": 1}}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('fails closed on an unsafe key nested inside "old"', () => {
        insertRawAuditRow('{"name": {"old": {"__proto__": {"x": 1}}, "new": 1}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('fails closed on an unsafe key nested inside "new"', () => {
        insertRawAuditRow('{"name": {"old": 1, "new": {"constructor": {"x": 1}}}}')
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('fails closed on an unsafe key several objects deep', () => {
        insertRawAuditRow(
          JSON.stringify({
            name: {
              old: null,
              new: { level1: { level2: { level3: { prototype: { x: 1 } } } } }
            }
          })
        )
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('fails closed on an unsafe key inside an object nested inside an array element', () => {
        // Deliberately a raw string literal, not JSON.stringify({...
        // __proto__: ... }) -- a JS object literal's __proto__ key sets
        // the object's prototype rather than creating an own property,
        // so JSON.stringify would silently drop it and produce JSON
        // that never actually contains the string "__proto__" at all
        // (confirmed directly before writing this test this way).
        insertRawAuditRow(
          '{"tags": {"old": null, "new": [{"label": "ok"}, {"__proto__": {"x": 1}}]}}'
        )
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('fails closed on an unsafe key inside an array nested inside an array', () => {
        insertRawAuditRow(
          JSON.stringify({
            matrix: { old: null, new: [[{ prototype: { x: 1 } }]] }
          })
        )
        expect(() => listEntries(db)).toThrow(AuditServiceError)
      })

      it('never mutates Object.prototype for an unsafe key nested arbitrarily deep', () => {
        // Same reasoning as above: a raw string literal, since a JS
        // object literal's __proto__ key never survives JSON.stringify.
        insertRawAuditRow(
          '{"name": {"old": null, "new": [{"a": {"b": {"__proto__": {"polluted": true}}}}]}}'
        )
        expect(() => listEntries(db)).toThrow(AuditServiceError)
        expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      })

      it('a safe, deeply nested object passes validation and round-trips exactly', () => {
        const safePayload = {
          name: {
            old: null,
            new: {
              level1: {
                level2: { level3: 'deep value', items: [1, 'two', true, null] }
              }
            }
          }
        }
        insertRawAuditRow(JSON.stringify(safePayload))
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual(safePayload)
      })

      it('a safe array of objects passes validation and round-trips exactly', () => {
        const safePayload = {
          roleAssignments: {
            old: [],
            new: [
              { userId: 'u1', roleId: 'role_finance' },
              { userId: 'u2', roleId: 'role_operations' }
            ]
          }
        }
        insertRawAuditRow(JSON.stringify(safePayload))
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual(safePayload)
      })

      it('an array containing only primitives and null passes validation', () => {
        const safePayload = { tags: { old: null, new: [1, 'two', true, null, 3.5] } }
        insertRawAuditRow(JSON.stringify(safePayload))
        const result = listEntries(db)
        expect(result.entries[0].changedFields).toEqual(safePayload)
      })
    })

    it('the error message is never exposed as the exception thrown to a caller outside this module in a way that leaks raw internals', () => {
      insertRawAuditRow('{not valid json')
      try {
        listEntries(db)
        expect.unreachable('listEntries should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AuditServiceError)
        // The error is a controlled, named type -- it is the IPC
        // handler layer's job (verified separately in
        // registerAuditHandlers.test.ts) to catch this and never
        // forward its message to a renderer; this test only confirms
        // the error this module throws is of that controlled type.
      }
    })
  })
})

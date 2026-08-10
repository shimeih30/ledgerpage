import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createAccount, deactivateAccount } from '../../../src/main/db/chartOfAccountsService'
import {
  createJournalEntry,
  getJournalEntryById,
  listJournalEntries,
  reverseJournalEntry,
  JournalEntryServiceError
} from '../../../src/main/db/journalEntryService'
import * as journalEntryService from '../../../src/main/db/journalEntryService'
import { JournalEntryValidationError } from '../../../src/main/db/validation/journalEntryValidation'
import {
  FUNCTIONAL_CURRENCY_ID,
  journalEntries,
  journalEntryLines,
  numberingRules,
  userRoles
} from '../../../src/main/db/schema'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import type { AuditActor } from '../../../src/main/audit/auditService'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const SYSTEM_ACTOR: AuditActor = { type: 'system' }
const REAL_PASSWORD = 'a-strong-password-1'

describe('journalEntryService', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb
  let userActor: AuditActor
  let cashAccountId: string
  let revenueAccountId: string

  beforeEach(async () => {
    dir = createTempDir('ledgerpage-journal-entry-service')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
    createCompany(db, {
      name: 'Fixture Co',
      address: 'Addr',
      contactDetails: 'contact@example.com',
      currencyId: 'currency_usd'
    })
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_journal_entry', 'primary_company', 'journal_entry', 'JE', 6, 'yearly', 0, NULL, ?, ?)`
      )
      .run(now, now)
    const passwordHash = await hashPassword(REAL_PASSWORD)
    const user = db.transaction((tx) =>
      createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
    )
    db.insert(userRoles)
      .values({ userId: user.id, roleId: 'role_owner', createdAt: new Date() })
      .run()
    userActor = { type: 'user', userId: user.id }

    cashAccountId = createAccount(
      db,
      { code: '1000', name: 'Cash on Hand', category: 'asset' },
      SYSTEM_ACTOR
    ).id
    revenueAccountId = createAccount(
      db,
      { code: '4000', name: 'Sales Revenue', category: 'revenue' },
      SYSTEM_ACTOR
    ).id
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  function rawAuditRowsFor(entityId: string): { action: string; entityType: string }[] {
    return rawDb
      .prepare(
        'SELECT action, entity_type as entityType FROM audit_log_entries WHERE entity_id = ?'
      )
      .all(entityId) as { action: string; entityType: string }[]
  }

  function balancedLines(debitMinor = 10000) {
    return [
      { accountId: cashAccountId, debitMinor, creditMinor: 0 },
      { accountId: revenueAccountId, debitMinor: 0, creditMinor: debitMinor }
    ]
  }

  describe('createJournalEntry', () => {
    it('creates a valid balanced two-line entry', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date('2026-01-01'), description: 'Cash sale', lines: balancedLines() },
        userActor
      )
      expect(entry.description).toBe('Cash sale')
      expect(entry.lines).toHaveLength(2)
    })

    it('allocates a JE-prefixed entry number following the yearly numbering format', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(entry.entryNumber).toMatch(/^JE-\d{4}-\d{6}$/)
    })

    it('currency is always pinned to FUNCTIONAL_CURRENCY_ID', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(entry.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    })

    it('createdByUserId is set from the actor', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(entry.createdByUserId).toBe((userActor as { userId: string }).userId)
    })

    it('externalReference is nullable and omittable', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(entry.externalReference).toBeNull()
    })

    it('description is trimmed', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: '  Cash sale  ', lines: balancedLines() },
        userActor
      )
      expect(entry.description).toBe('Cash sale')
    })

    it('line descriptions are trimmed, and a blank line description becomes null', () => {
      const entry = createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'X',
          lines: [
            { accountId: cashAccountId, debitMinor: 500, creditMinor: 0, description: '  Note  ' },
            { accountId: revenueAccountId, debitMinor: 0, creditMinor: 500, description: '   ' }
          ]
        },
        userActor
      )
      expect(entry.lines[0].description).toBe('Note')
      expect(entry.lines[1].description).toBeNull()
    })

    it('line order is deterministic, matching the order supplied', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(entry.lines[0].lineOrder).toBe(0)
      expect(entry.lines[1].lineOrder).toBe(1)
      expect(entry.lines[0].accountId).toBe(cashAccountId)
      expect(entry.lines[1].accountId).toBe(revenueAccountId)
    })

    it('the same account may appear on multiple lines', () => {
      const entry = createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'Split debit',
          lines: [
            { accountId: cashAccountId, debitMinor: 300, creditMinor: 0 },
            { accountId: cashAccountId, debitMinor: 200, creditMinor: 0 },
            { accountId: revenueAccountId, debitMinor: 0, creditMinor: 500 }
          ]
        },
        userActor
      )
      expect(entry.lines).toHaveLength(3)
      expect(entry.lines.filter((l) => l.accountId === cashAccountId)).toHaveLength(2)
    })

    it('writes exactly one journal_entry audit row and zero journal_entry_line audit rows', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(rawAuditRowsFor(entry.id)).toEqual([{ action: 'create', entityType: 'journal_entry' }])
      const lineAuditRows = rawDb
        .prepare(
          "SELECT COUNT(*) as count FROM audit_log_entries WHERE entity_type = 'journal_entry_line'"
        )
        .get() as { count: number }
      expect(lineAuditRows.count).toBe(0)
    })

    it('numbering allocation happens inside the same transaction as the entry insert', () => {
      createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const rulesAfter = db.select().from(numberingRules).all()
      const journalRule = rulesAfter.find((r) => r.documentTypeKey === 'journal_entry')
      expect(journalRule?.currentSequenceValue).toBe(1)
    })

    describe('validation failures', () => {
      it('rejects fewer than two lines', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [{ accountId: cashAccountId, debitMinor: 100, creditMinor: 0 }]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects unbalanced debit/credit totals', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: 100, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 99 }
              ]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects a zero-value total', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: 0, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 0 }
              ]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects a line with both debit and credit positive', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: 100, creditMinor: 100 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100 }
              ]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects negative amounts', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: -100, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100 }
              ]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects non-integer amounts', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: 100.5, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100.5 }
              ]
            },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects a missing/blank description', () => {
        expect(() =>
          createJournalEntry(
            db,
            { entryDate: new Date(), description: '   ', lines: balancedLines() },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects an invalid entry date', () => {
        expect(() =>
          createJournalEntry(
            db,
            { entryDate: new Date('not-a-date'), description: 'X', lines: balancedLines() },
            userActor
          )
        ).toThrow(JournalEntryValidationError)
      })

      it('rejects a missing account', () => {
        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: 'does-not-exist', debitMinor: 100, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 100 }
              ]
            },
            userActor
          )
        ).toThrow()
      })

      it('rejects an inactive account', () => {
        deactivateAccount(db, cashAccountId, SYSTEM_ACTOR)
        expect(() =>
          createJournalEntry(
            db,
            { entryDate: new Date(), description: 'X', lines: balancedLines() },
            userActor
          )
        ).toThrow()
      })

      it('a validation failure rolls back entirely: no entry, no lines, no numbering increment, no audit row', () => {
        const ruleBefore = db.select().from(numberingRules).all()[0]
        const auditCountBefore = (
          rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
            count: number
          }
        ).count

        expect(() =>
          createJournalEntry(
            db,
            {
              entryDate: new Date(),
              description: 'X',
              lines: [
                { accountId: cashAccountId, debitMinor: 100, creditMinor: 0 },
                { accountId: revenueAccountId, debitMinor: 0, creditMinor: 99 }
              ]
            },
            userActor
          )
        ).toThrow()

        expect(db.select().from(journalEntries).all()).toHaveLength(0)
        expect(db.select().from(journalEntryLines).all()).toHaveLength(0)
        const ruleAfter = db.select().from(numberingRules).all()[0]
        expect(ruleAfter.currentSequenceValue).toBe(ruleBefore.currentSequenceValue)
        const auditCountAfter = (
          rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
            count: number
          }
        ).count
        expect(auditCountAfter).toBe(auditCountBefore)
      })
    })
  })

  describe('read behavior', () => {
    it('getJournalEntryById returns the header with ordered lines', () => {
      const created = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const fetched = getJournalEntryById(db, created.id)
      expect(fetched?.lines.map((l) => l.lineOrder)).toEqual([0, 1])
    })

    it('listJournalEntries ordering is deterministic', () => {
      const first = createJournalEntry(
        db,
        { entryDate: new Date('2026-01-01'), description: 'First', lines: balancedLines() },
        userActor
      )
      const second = createJournalEntry(
        db,
        { entryDate: new Date('2026-01-02'), description: 'Second', lines: balancedLines() },
        userActor
      )
      const list = listJournalEntries(db)
      expect(list.map((e) => e.id)).toEqual([first.id, second.id])
    })

    it('inactive accounts referenced by historical lines remain readable', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      deactivateAccount(db, cashAccountId, SYSTEM_ACTOR)
      const fetched = getJournalEntryById(db, entry.id)
      expect(fetched?.lines[0].accountId).toBe(cashAccountId)
    })
  })

  describe('reverseJournalEntry', () => {
    it('requires a trimmed, non-blank reason', () => {
      const entry = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      expect(() => reverseJournalEntry(db, entry.id, '   ', userActor)).toThrow(
        JournalEntryServiceError
      )
    })

    it('creates a new entry with a new JE number', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)
      expect(reversal.entryNumber).not.toBe(original.entryNumber)
    })

    it('the reversal references the original via reversedEntryId', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)
      expect(reversal.reversedEntryId).toBe(original.id)
      expect(reversal.reversalReason).toBe('Undo')
    })

    it('every debit/credit is exactly swapped, account/order/description preserved', () => {
      const original = createJournalEntry(
        db,
        {
          entryDate: new Date(),
          description: 'X',
          lines: [
            { accountId: cashAccountId, debitMinor: 500, creditMinor: 0, description: 'Cash in' },
            {
              accountId: revenueAccountId,
              debitMinor: 0,
              creditMinor: 500,
              description: 'Revenue'
            }
          ]
        },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)

      expect(reversal.lines[0].accountId).toBe(original.lines[0].accountId)
      expect(reversal.lines[0].debitMinor).toBe(original.lines[0].creditMinor)
      expect(reversal.lines[0].creditMinor).toBe(original.lines[0].debitMinor)
      expect(reversal.lines[0].lineOrder).toBe(original.lines[0].lineOrder)
      expect(reversal.lines[0].description).toBe('Cash in')

      expect(reversal.lines[1].accountId).toBe(original.lines[1].accountId)
      expect(reversal.lines[1].debitMinor).toBe(original.lines[1].creditMinor)
      expect(reversal.lines[1].creditMinor).toBe(original.lines[1].debitMinor)
    })

    it('currency is preserved as the functional currency on the reversal', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)
      expect(reversal.currencyId).toBe(FUNCTIONAL_CURRENCY_ID)
    })

    it('the original entry and lines remain byte-identical after reversal', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      reverseJournalEntry(db, original.id, 'Undo', userActor)
      const originalAfter = getJournalEntryById(db, original.id)
      expect(originalAfter).toEqual(original)
    })

    it('inactive accounts do not block reversal', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      deactivateAccount(db, cashAccountId, SYSTEM_ACTOR)
      expect(() => reverseJournalEntry(db, original.id, 'Undo', userActor)).not.toThrow()
    })

    it('an entry can be reversed once only', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      reverseJournalEntry(db, original.id, 'First', userActor)
      expect(() => reverseJournalEntry(db, original.id, 'Second', userActor)).toThrow(
        JournalEntryServiceError
      )
    })

    it('a reversal entry cannot itself be reversed', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)
      expect(() => reverseJournalEntry(db, reversal.id, 'Undo the undo', userActor)).toThrow(
        JournalEntryServiceError
      )
    })

    it('writes one create audit row for the reversal, and no update audit row on the original', () => {
      const original = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      )
      const reversal = reverseJournalEntry(db, original.id, 'Undo', userActor)

      expect(rawAuditRowsFor(reversal.id)).toEqual([
        { action: 'create', entityType: 'journal_entry' }
      ])
      expect(rawAuditRowsFor(original.id)).toEqual([
        { action: 'create', entityType: 'journal_entry' }
      ])
    })

    it('a reversal failure rolls back entirely', () => {
      const journalCountBefore = db.select().from(journalEntries).all().length

      expect(() => reverseJournalEntry(db, 'does-not-exist', 'Undo', userActor)).toThrow()

      expect(db.select().from(journalEntries).all()).toHaveLength(journalCountBefore)
    })
  })

  describe('structural immutability', () => {
    it('exports no update/delete/remove function for journal entries or lines', () => {
      const exportedNames = Object.keys(journalEntryService)
      const forbidden = ['update', 'delete', 'remove']
      for (const name of exportedNames) {
        const lower = name.toLowerCase()
        for (const term of forbidden) {
          expect(lower).not.toContain(term)
        }
      }
    })
  })

  describe('direct SQL constraints', () => {
    let entryId: string

    beforeEach(() => {
      entryId = createJournalEntry(
        db,
        { entryDate: new Date(), description: 'X', lines: balancedLines() },
        userActor
      ).id
    })

    function insertRawLine(overrides: Record<string, string | number | null> = {}) {
      const fields = {
        id: `journal_entry_line_${Math.random()}`,
        company_id: 'primary_company',
        journal_entry_id: entryId,
        account_id: cashAccountId,
        debit_minor: 100,
        credit_minor: 0,
        line_order: 99,
        ...overrides
      }
      const columns = Object.keys(fields).join(', ')
      const placeholders = Object.keys(fields)
        .map(() => '?')
        .join(', ')
      rawDb
        .prepare(`INSERT INTO journal_entry_lines (${columns}) VALUES (${placeholders})`)
        .run(...Object.values(fields))
    }

    it('rejects invalid debit/credit line combinations', () => {
      expect(() => insertRawLine({ debit_minor: 100, credit_minor: 100 })).toThrow(
        /CHECK constraint failed/
      )
      expect(() => insertRawLine({ debit_minor: 0, credit_minor: 0 })).toThrow(
        /CHECK constraint failed/
      )
    })

    it('rejects a duplicate lineOrder within one journal', () => {
      insertRawLine({ line_order: 5 })
      expect(() => insertRawLine({ line_order: 5 })).toThrow(/UNIQUE constraint failed/)
    })

    it('rejects an invalid account FK', () => {
      expect(() => insertRawLine({ account_id: 'does-not-exist' })).toThrow(
        /FOREIGN KEY constraint failed/
      )
    })

    it('rejects an invalid journal FK', () => {
      expect(() => insertRawLine({ journal_entry_id: 'does-not-exist' })).toThrow(
        /FOREIGN KEY constraint failed/
      )
    })

    it('enforces reversalReason/reversedEntryId nullability pairing', () => {
      const now = Date.now()
      const anyUser = db.select().from(userRoles).all()[0]?.userId
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO journal_entries
             (id, company_id, entry_number, entry_date, description, currency_id, created_by_user_id, reversal_reason, created_at)
             VALUES ('je_x', 'primary_company', 'JE-000099', ?, 'X', 'currency_usd', ?, 'orphan reason', ?)`
          )
          .run(now, anyUser, now)
      ).toThrow(/CHECK constraint failed/)
    })

    it('enforces reversedEntryId uniqueness', () => {
      reverseJournalEntry(db, entryId, 'First reversal', userActor)
      const anyUser = db.select().from(userRoles).all()[0]?.userId
      const now = Date.now()
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO journal_entries
             (id, company_id, entry_number, entry_date, description, currency_id, created_by_user_id, reversed_entry_id, reversal_reason, created_at)
             VALUES ('je_dupe_reversal', 'primary_company', 'JE-000098', ?, 'X', 'currency_usd', ?, ?, 'dup', ?)`
          )
          .run(now, anyUser, entryId, now)
      ).toThrow(/UNIQUE constraint failed/)
    })
  })
})

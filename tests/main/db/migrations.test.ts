import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createUser } from '../../../src/main/auth/userService'
import { hashPassword } from '../../../src/main/auth/passwordHashing'
import { userRoles } from '../../../src/main/db/schema'
import type { AppDb } from '../../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'
import { buildTruncatedMigrationsFolder } from '../../helpers/migrationFixtures'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'

interface SqliteTableRow {
  name: string
}
interface SqliteIndexRow {
  name: string
}
interface ForeignKeyRow {
  table: string
  from: string
  to: string
  on_delete: string
}

describe('Slice 10 migration (0004_audit_logging)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0004')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  describe('fresh database', () => {
    it('applies all migrations 0000-0004 cleanly, including audit_log_entries', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tables.map((t) => t.name)).toContain('audit_log_entries')

      rawDb.close()
    })

    it('creates both required indexes on audit_log_entries', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const indexes = rawDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log_entries'"
        )
        .all() as SqliteIndexRow[]
      const indexNames = indexes.map((i) => i.name)
      expect(indexNames).toContain('audit_log_entries_occurred_at_id_idx')
      expect(indexNames).toContain('audit_log_entries_entity_type_idx')

      rawDb.close()
    })

    it('the user_id foreign key on audit_log_entries uses ON DELETE RESTRICT', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const foreignKeys = rawDb
        .prepare('PRAGMA foreign_key_list(audit_log_entries)')
        .all() as ForeignKeyRow[]
      const userFk = foreignKeys.find((fk) => fk.table === 'users' && fk.from === 'user_id')
      expect(userFk).toBeDefined()
      expect(userFk?.on_delete.toUpperCase()).toBe('RESTRICT')

      rawDb.close()
    })

    it('the CHECK constraints reject an invalid action value', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad', 'x', '1', 'x', 'delete', 'system', NULL, NULL, ?)`
          )
          .run(Date.now())
      }).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the CHECK constraints reject an actor_type/user_id inconsistency in either direction', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      // system actor with a non-null user_id — invalid even though the
      // user_id itself would otherwise satisfy the FK.
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad1', 'x', '1', 'x', 'create', 'system', 'primary_company', NULL, ?)`
          )
          .run(Date.now())
      }).toThrow(/CHECK constraint failed/)

      // user actor with a null user_id.
      expect(() => {
        rawDb
          .prepare(
            `INSERT INTO audit_log_entries
             (id, entity_type, entity_id, entity_label, action, actor_type, user_id, company_id, occurred_at)
             VALUES ('bad2', 'x', '1', 'x', 'create', 'user', NULL, NULL, ?)`
          )
          .run(Date.now())
      }).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })
  })

  describe('upgrade from an approved Slice 9 database', () => {
    it('a database with only migrations 0000-0003 applied upgrades cleanly through 0004, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0003')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 4)

      // Simulate an approved Slice 9 install: only 0000-0003 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('audit_log_entries')

      // Seed real Slice 5/6/7 data on this pre-Slice-10 database.
      seedReferenceData(rawDb)
      seedRoles(rawDb)
      const db = drizzle<Record<string, never>>(rawDb) as AppDb
      createCompany(
        db,
        {
          name: 'Farmer Ben Sauces',
          address: '1 Main St',
          contactDetails: 'ben@example.com',
          currencyId: 'currency_usd'
        },
        new Date()
      )
      // Deliberately NOT using createTaxCode() here — that function is
      // now retrofitted (Slice 10) to also write an audit row, which
      // would fail against this pre-upgrade database (no
      // audit_log_entries table exists yet). A direct insert
      // accurately simulates what the real, un-retrofitted Slice 9
      // function actually wrote to a real Slice-9-era database.
      const taxCodeId = 'tax_code_fixture_std'
      rawDb
        .prepare(
          `INSERT INTO tax_codes
             (id, company_id, code, name, description, category, is_active, created_at, updated_at)
             VALUES (?, 'primary_company', 'STD', 'Standard', NULL, 'standard', 1, ?, ?)`
        )
        .run(taxCodeId, Date.now(), Date.now())
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const owner = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )
      db.insert(userRoles)
        .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
        .run()

      // Now upgrade: apply the full, real migrations folder (0000-0004)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('audit_log_entries')

      // Every table's pre-existing data survives the upgrade intact.
      const companyRow = rawDb.prepare('SELECT * FROM company').get() as
        { name: string } | undefined
      expect(companyRow?.name).toBe('Farmer Ben Sauces')

      const taxCodeRow = rawDb.prepare('SELECT * FROM tax_codes WHERE id = ?').get(taxCodeId) as
        { code: string } | undefined
      expect(taxCodeRow?.code).toBe('STD')

      const userRow = rawDb.prepare('SELECT * FROM users WHERE id = ?').get(owner.id) as
        { login_identifier: string } | undefined
      expect(userRow?.login_identifier).toBe('ben')

      const roleRows = rawDb.prepare('SELECT * FROM roles').all() as { code: string }[]
      expect(roleRows.map((r) => r.code).sort()).toEqual(
        ['owner', 'executive', 'operations', 'finance'].sort()
      )

      const userRoleRow = rawDb
        .prepare('SELECT * FROM user_roles WHERE user_id = ?')
        .get(owner.id) as { role_id: string } | undefined
      expect(userRoleRow?.role_id).toBe('role_owner')

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0003 are byte-identical to their state at the approved m1-slice-09 tag', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-09', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

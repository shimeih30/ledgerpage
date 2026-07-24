import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { createCompany } from '../../../src/main/db/companyService'
import { createTaxCode } from '../../../src/main/db/taxCodeService'
import { createProduct } from '../../../src/main/db/productService'
import { createVariant } from '../../../src/main/db/productVariantService'
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

describe('Slice 11 migration (0005_products_and_variants)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0005')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  describe('fresh database', () => {
    it('applies all migrations 0000-0005 cleanly, including products and product_variants', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('products')
      expect(tableNames).toContain('product_variants')

      rawDb.close()
    })

    it('rejects a second product with a duplicate (company_id, code) pair', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      const insertProduct = () =>
        rawDb
          .prepare(
            `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
             VALUES (?, 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
          )
          .run(`product_${Math.random()}`, Date.now(), Date.now())

      insertProduct()
      expect(insertProduct).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('the product type CHECK constraint rejects an out-of-range value', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
             VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'bogus', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('rejects a second variant with a duplicate (product_id, code) pair', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      rawDb
        .prepare(
          `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
           VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
        )
        .run(Date.now(), Date.now())

      const insertVariant = () =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES (?, 'p1', 'A', 'X', 0, 'currency_usd', 0, 1, ?, ?)`
          )
          .run(`variant_${Math.random()}`, Date.now(), Date.now())

      insertVariant()
      expect(insertVariant).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('the non-null-barcode partial unique index rejects a duplicate real barcode but allows two nulls', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      rawDb
        .prepare(
          `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
           VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
        )
        .run(Date.now(), Date.now())

      // Two null barcodes: both succeed.
      rawDb
        .prepare(
          `INSERT INTO product_variants
           (id, product_id, code, name, selling_price_minor, currency_id, barcode, minimum_finished_stock_level, is_active, created_at, updated_at)
           VALUES ('v1', 'p1', 'A', 'A', 0, 'currency_usd', NULL, 0, 1, ?, ?)`
        )
        .run(Date.now(), Date.now())
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, barcode, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v2', 'p1', 'B', 'B', 0, 'currency_usd', NULL, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).not.toThrow()

      // A real, duplicate barcode: rejected.
      rawDb
        .prepare(
          `INSERT INTO product_variants
           (id, product_id, code, name, selling_price_minor, currency_id, barcode, minimum_finished_stock_level, is_active, created_at, updated_at)
           VALUES ('v3', 'p1', 'C', 'C', 0, 'currency_usd', '999', 0, 1, ?, ?)`
        )
        .run(Date.now(), Date.now())
      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, barcode, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v4', 'p1', 'D', 'D', 0, 'currency_usd', '999', 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('the price and minimum-stock CHECK constraints reject negative values', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      rawDb
        .prepare(
          `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
           VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
        )
        .run(Date.now(), Date.now())

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v1', 'p1', 'A', 'A', -1, 'currency_usd', 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v2', 'p1', 'B', 'B', 0, 'currency_usd', -1, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the product_id foreign key behaves as designed: a delete that would orphan a variant is rejected', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      rawDb
        .prepare(
          `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
           VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
        )
        .run(Date.now(), Date.now())
      rawDb
        .prepare(
          `INSERT INTO product_variants
           (id, product_id, code, name, selling_price_minor, currency_id, minimum_finished_stock_level, is_active, created_at, updated_at)
           VALUES ('v1', 'p1', 'A', 'A', 0, 'currency_usd', 0, 1, ?, ?)`
        )
        .run(Date.now(), Date.now())

      expect(() => rawDb.prepare('DELETE FROM products WHERE id = ?').run('p1')).toThrow(
        /FOREIGN KEY constraint failed/
      )

      rawDb.close()
    })

    it('the tax_code_id foreign key rejects a reference to a nonexistent tax code, and allows null', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      rawDb
        .prepare(
          `INSERT INTO products (id, company_id, code, name, type, is_active, created_at, updated_at)
           VALUES ('p1', 'primary_company', 'PRD-000001', 'X', 'manufactured', 1, ?, ?)`
        )
        .run(Date.now(), Date.now())

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, tax_code_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v1', 'p1', 'A', 'A', 0, 'currency_usd', 'does-not-exist', 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO product_variants
             (id, product_id, code, name, selling_price_minor, currency_id, tax_code_id, minimum_finished_stock_level, is_active, created_at, updated_at)
             VALUES ('v2', 'p1', 'B', 'B', 0, 'currency_usd', NULL, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).not.toThrow()

      rawDb.close()
    })
  })

  describe('upgrade from an approved Slice 10 database', () => {
    it('a database with only migrations 0000-0004 applied upgrades cleanly through 0005, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0004')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 5)

      // Simulate an approved Slice 10 install: only 0000-0004 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('products')
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('product_variants')

      // Seed real Slice 5-10 data on this pre-Slice-11 database. Every
      // table used here (company, numbering_rules, tax_codes, users,
      // roles, user_roles, audit_log_entries) already exists at
      // 0000-0004 -- unlike the Slice 10 upgrade test above (which
      // simulates a pre-0004 baseline and must avoid createTaxCode()
      // for that reason), audit_log_entries already exists here, so the
      // real, audit-writing service functions are used directly rather
      // than a bypassing direct insert.
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
      const now = new Date()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_product', 'primary_company', 'product', 'PRD', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(now.getTime(), now.getTime())
      const taxCode = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        { type: 'system' }
      )
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const owner = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )
      db.insert(userRoles)
        .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
        .run()

      const auditRowCountBeforeUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountBeforeUpgrade).toBeGreaterThan(0)

      // Now upgrade: apply the full, real migrations folder (0000-0005)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('products')
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('product_variants')

      // Every table's pre-existing data survives the upgrade intact.
      const companyRow = rawDb.prepare('SELECT * FROM company').get() as
        { name: string } | undefined
      expect(companyRow?.name).toBe('Farmer Ben Sauces')

      const numberingRuleRow = rawDb
        .prepare("SELECT * FROM numbering_rules WHERE document_type_key = 'product'")
        .get() as { prefix: string } | undefined
      expect(numberingRuleRow?.prefix).toBe('PRD')

      const taxCodeRow = rawDb.prepare('SELECT * FROM tax_codes WHERE id = ?').get(taxCode.id) as
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

      const auditRowCountAfterUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountAfterUpgrade).toBe(auditRowCountBeforeUpgrade)

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0004 are byte-identical to their state at the approved m1-slice-10 tag', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql',
        'migrations/0004_audit_logging.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-10', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

describe('Slice 12 migration (0006_inventory_items)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0006')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  describe('fresh database', () => {
    it('applies all migrations 0000-0006 cleanly, including inventory_items', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tables.map((t) => t.name)).toContain('inventory_items')

      rawDb.close()
    })

    it('rejects a second item with a duplicate (company_id, code) pair', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      const insertItem = () =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES (?, 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'uom_kg', 0, 0, 0, 0, 0, 1, ?, ?)`
          )
          .run(`item_${Math.random()}`, Date.now(), Date.now())

      insertItem()
      expect(insertItem).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('the item type CHECK constraint rejects an out-of-range value', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'bogus', 'uom_kg', 0, 0, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the minimum_stock, reorder_quantity, and lead_time_days CHECK constraints reject negative values', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'uom_kg', -1, 0, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i2', 'primary_company', 'SUGAR', 'Sugar', 'Dry goods', 'ingredient', 'uom_kg', 0, -1, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i3', 'primary_company', 'SALT', 'Salt', 'Dry goods', 'ingredient', 'uom_kg', 0, 0, -1, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the maximum_stock CHECK constraint allows null but rejects a negative value', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, maximum_stock, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'uom_kg', 0, 0, NULL, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).not.toThrow()

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, maximum_stock, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i2', 'primary_company', 'SUGAR', 'Sugar', 'Dry goods', 'ingredient', 'uom_kg', 0, 0, -1, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the maximum_stock >= minimum_stock CHECK constraint rejects a lower maximum_stock', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, maximum_stock, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'uom_kg', 10, 0, 5, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, maximum_stock, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i2', 'primary_company', 'SUGAR', 'Sugar', 'Dry goods', 'ingredient', 'uom_kg', 5, 0, 10, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).not.toThrow()

      rawDb.close()
    })

    it('rejects a company_id other than the singleton', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'some_other_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'uom_kg', 0, 0, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow()

      rawDb.close()
    })

    it('the unit_of_measure_id foreign key rejects a reference to a nonexistent unit', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO inventory_items
             (id, company_id, code, name, category, item_type, unit_of_measure_id, minimum_stock, reorder_quantity, lead_time_days, lot_tracked, expiry_tracked, is_active, created_at, updated_at)
             VALUES ('i1', 'primary_company', 'FLOUR', 'Flour', 'Dry goods', 'ingredient', 'does-not-exist', 0, 0, 0, 0, 0, 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })
  })

  describe('upgrade from an approved Slice 11 database', () => {
    it('a database with only migrations 0000-0005 applied upgrades cleanly through 0006, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0005')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 6)

      // Simulate an approved Slice 11 install: only 0000-0005 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('inventory_items')

      // Seed real Slice 5-11 data on this pre-Slice-12 database. Every
      // table used here already exists at 0000-0005, so the real,
      // audit-writing service functions are used directly rather than a
      // bypassing direct insert.
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
      const now = new Date()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_product', 'primary_company', 'product', 'PRD', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(now.getTime(), now.getTime())
      const taxCode = createTaxCode(
        db,
        { code: 'STD', name: 'Standard', category: 'standard' },
        { type: 'system' }
      )
      const passwordHash = await hashPassword(REAL_PASSWORD)
      const owner = db.transaction((tx) =>
        createUser(tx, { loginIdentifier: 'ben', displayName: 'Ben', passwordHash })
      )
      db.insert(userRoles)
        .values({ userId: owner.id, roleId: 'role_owner', createdAt: new Date() })
        .run()
      const product = createProduct(
        db,
        { name: 'Chilli Sauce', type: 'manufactured' },
        { type: 'system' }
      )
      const variant = createVariant(
        db,
        { productId: product.id, code: '100ML', name: '100 ml bottle', sellingPriceMinor: 1029 },
        { type: 'system' }
      )

      const auditRowCountBeforeUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountBeforeUpgrade).toBeGreaterThan(0)

      // Now upgrade: apply the full, real migrations folder (0000-0006)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('inventory_items')

      // Every table's pre-existing data survives the upgrade intact.
      const companyRow = rawDb.prepare('SELECT * FROM company').get() as
        { name: string } | undefined
      expect(companyRow?.name).toBe('Farmer Ben Sauces')

      const taxCodeRow = rawDb.prepare('SELECT * FROM tax_codes WHERE id = ?').get(taxCode.id) as
        { code: string } | undefined
      expect(taxCodeRow?.code).toBe('STD')

      const userRow = rawDb.prepare('SELECT * FROM users WHERE id = ?').get(owner.id) as
        { login_identifier: string } | undefined
      expect(userRow?.login_identifier).toBe('ben')

      const roleRows = rawDb.prepare('SELECT * FROM roles').all() as { code: string }[]
      expect(roleRows.map((r) => r.code).sort()).toEqual(
        ['owner', 'executive', 'operations', 'finance'].sort()
      )

      const productRow = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(product.id) as
        { code: string } | undefined
      expect(productRow?.code).toBe('PRD-000001')

      const variantRow = rawDb
        .prepare('SELECT * FROM product_variants WHERE id = ?')
        .get(variant.id) as { code: string } | undefined
      expect(variantRow?.code).toBe('100ML')

      const auditRowCountAfterUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountAfterUpgrade).toBe(auditRowCountBeforeUpgrade)

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0005 remain byte-identical to their state at the approved m1-slice-11 tag', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql',
        'migrations/0004_audit_logging.sql',
        'migrations/0005_products_and_variants.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-11', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

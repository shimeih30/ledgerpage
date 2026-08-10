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
import { createInventoryItem } from '../../../src/main/db/inventoryItemService'
import { createSupplier } from '../../../src/main/db/supplierService'
import { recordSupplierPrice } from '../../../src/main/db/supplierPriceService'
import { createCustomer } from '../../../src/main/db/customerService'
import { createCustomerContact } from '../../../src/main/db/customerContactService'
import { createOpeningLot } from '../../../src/main/db/inventoryLotService'
import { recordAdjustment, reverseMovement } from '../../../src/main/db/stockMovementService'
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

describe('Slice 13 migration (0007_suppliers)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0007')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function seedSupplierNumberingRule(rawDb: ReturnType<typeof createDatabaseConnection>): void {
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
  }

  describe('fresh database', () => {
    it('applies all migrations 0000-0007 cleanly, including suppliers and supplier_item_prices', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tables.map((t) => t.name)).toContain('suppliers')
      expect(tables.map((t) => t.name)).toContain('supplier_item_prices')

      rawDb.close()
    })

    it('applies the expected indexes on supplier_item_prices', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const indexes = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
        .all('supplier_item_prices') as SqliteIndexRow[]
      const names = indexes.map((i) => i.name)
      expect(names).toContain('supplier_item_prices_supplier_idx')
      expect(names).toContain('supplier_item_prices_item_idx')
      expect(names).toContain('supplier_item_prices_supplier_item_effective_unique')

      rawDb.close()
    })

    it('rejects a second supplier with a duplicate (company_id, code) pair', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      const insertSupplier = () =>
        rawDb
          .prepare(
            `INSERT INTO suppliers (id, company_id, code, name, is_active, created_at, updated_at)
             VALUES (?, 'primary_company', 'SUP-000001', 'Acme', 1, ?, ?)`
          )
          .run(`supplier_${Math.random()}`, Date.now(), Date.now())

      insertSupplier()
      expect(insertSupplier).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('rejects a supplier company_id other than the singleton', () => {
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
            `INSERT INTO suppliers (id, company_id, code, name, is_active, created_at, updated_at)
             VALUES ('supplier_1', 'some_other_company', 'SUP-000001', 'Acme', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow()

      rawDb.close()
    })

    it('rejects a negative price_minor on supplier_item_prices', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      seedSupplierNumberingRule(rawDb)
      const supplier = createSupplier(db, { name: 'Acme' }, { type: 'system' })
      const item = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p1', ?, ?, -1, 'currency_usd', ?, ?)`
          )
          .run(supplier.id, item.id, Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('rejects a duplicate (supplier_id, inventory_item_id, effective_from) triple', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      seedSupplierNumberingRule(rawDb)
      const supplier = createSupplier(db, { name: 'Acme' }, { type: 'system' })
      const item = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )
      const effectiveFrom = Date.now()

      rawDb
        .prepare(
          `INSERT INTO supplier_item_prices
           (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
           VALUES ('p1', ?, ?, 100, 'currency_usd', ?, ?)`
        )
        .run(supplier.id, item.id, effectiveFrom, Date.now())

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p2', ?, ?, 200, 'currency_usd', ?, ?)`
          )
          .run(supplier.id, item.id, effectiveFrom, Date.now())
      ).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('the supplier_id foreign key rejects a reference to a nonexistent supplier', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      const item = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p1', 'does-not-exist', ?, 100, 'currency_usd', ?, ?)`
          )
          .run(item.id, Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })

    it('the inventory_item_id foreign key rejects a reference to a nonexistent item', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      seedSupplierNumberingRule(rawDb)
      const supplier = createSupplier(db, { name: 'Acme' }, { type: 'system' })

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p1', ?, 'does-not-exist', 100, 'currency_usd', ?, ?)`
          )
          .run(supplier.id, Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })

    it('the currency_id foreign key rejects a reference to a nonexistent currency', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      seedSupplierNumberingRule(rawDb)
      const supplier = createSupplier(db, { name: 'Acme' }, { type: 'system' })
      const item = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO supplier_item_prices
             (id, supplier_id, inventory_item_id, price_minor, currency_id, effective_from, created_at)
             VALUES ('p1', ?, ?, 100, 'does-not-exist', ?, ?)`
          )
          .run(supplier.id, item.id, Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })
  })

  describe('upgrade from an approved Slice 12 database', () => {
    it('a database with only migrations 0000-0006 applied upgrades cleanly through 0007, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0006')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 7)

      // Simulate an approved Slice 12 install: only 0000-0006 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('suppliers')

      // Seed real Slice 5-12 data on this pre-Slice-13 database, via the
      // real, audit-writing service functions.
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
      const inventoryItem = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )

      const auditRowCountBeforeUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountBeforeUpgrade).toBeGreaterThan(0)

      // Now upgrade: apply the full, real migrations folder (0000-0007)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      // This test manually inserts numbering rules rather than going
      // through the real first-run transaction (which would seed all 10
      // approved defaults, including 'supplier', unconditionally) -- so
      // the 'supplier' rule needs the same manual seeding here, applied
      // after the upgrade to confirm it's exactly the kind of rule a
      // real post-upgrade database would already have from Slice 8.
      const supplierNumberingNow = Date.now()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(supplierNumberingNow, supplierNumberingNow)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('suppliers')
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('supplier_item_prices')

      // The new supplier numbering rule is already present after the
      // upgrade, seeded at first-run in Slice 8 (unused until now) --
      // confirms a supplier can be created immediately post-upgrade.
      const supplier = createSupplier(db, { name: 'Acme Foods' }, { type: 'system' })
      expect(supplier.code).toBe('SUP-000001')
      const price = recordSupplierPrice(
        db,
        {
          supplierId: supplier.id,
          inventoryItemId: inventoryItem.id,
          priceMinor: 500,
          effectiveFrom: new Date()
        },
        { type: 'system' }
      )
      expect(price.priceMinor).toBe(500)

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

      const productRow = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(product.id) as
        { code: string } | undefined
      expect(productRow?.code).toBe('PRD-000001')

      const variantRow = rawDb
        .prepare('SELECT * FROM product_variants WHERE id = ?')
        .get(variant.id) as { code: string } | undefined
      expect(variantRow?.code).toBe('100ML')

      const itemRow = rawDb
        .prepare('SELECT * FROM inventory_items WHERE id = ?')
        .get(inventoryItem.id) as { code: string } | undefined
      expect(itemRow?.code).toBe('FLOUR')

      const auditRowCountAfterUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      // The upgrade itself adds no audit rows; creating the supplier and
      // recording its price afterward adds exactly 2 more.
      expect(auditRowCountAfterUpgrade).toBe(auditRowCountBeforeUpgrade + 2)

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0006 remain byte-identical to their state at the approved m1-slice-12 tag', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql',
        'migrations/0004_audit_logging.sql',
        'migrations/0005_products_and_variants.sql',
        'migrations/0006_inventory_items.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-12', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

describe('Slice 14 migration (0008_customers)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0008')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function seedCustomerNumberingRule(rawDb: ReturnType<typeof createDatabaseConnection>): void {
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_customer', 'primary_company', 'customer', 'CUS', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
  }

  describe('fresh database', () => {
    it('applies all migrations 0000-0008 cleanly, including customers and customer_contacts', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tables.map((t) => t.name)).toContain('customers')
      expect(tables.map((t) => t.name)).toContain('customer_contacts')

      rawDb.close()
    })

    it('applies the expected index on customer_contacts', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const indexes = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
        .all('customer_contacts') as SqliteIndexRow[]
      expect(indexes.map((i) => i.name)).toContain('customer_contacts_customer_idx')

      rawDb.close()
    })

    it('rejects a second customer with a duplicate (company_id, code) pair', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb)
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )

      const insertCustomer = () =>
        rawDb
          .prepare(
            `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
             VALUES (?, 'primary_company', 'CUS-000001', 'Acme', 'currency_usd', 1, ?, ?)`
          )
          .run(`customer_${Math.random()}`, Date.now(), Date.now())

      insertCustomer()
      expect(insertCustomer).toThrow(/UNIQUE constraint failed/)

      rawDb.close()
    })

    it('rejects a customer company_id other than the singleton', () => {
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
            `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
             VALUES ('customer_1', 'some_other_company', 'CUS-000001', 'Acme', 'currency_usd', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow()

      rawDb.close()
    })

    it('rejects a negative payment_terms_days', () => {
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
            `INSERT INTO customers (id, company_id, code, name, payment_terms_days, currency_id, is_active, created_at, updated_at)
             VALUES ('customer_1', 'primary_company', 'CUS-000001', 'Acme', -1, 'currency_usd', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('rejects a negative credit_limit_minor', () => {
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
            `INSERT INTO customers (id, company_id, code, name, credit_limit_minor, currency_id, is_active, created_at, updated_at)
             VALUES ('customer_1', 'primary_company', 'CUS-000001', 'Acme', -1, 'currency_usd', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/CHECK constraint failed/)

      rawDb.close()
    })

    it('the company_id foreign key rejects a reference to a nonexistent company', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
             VALUES ('customer_1', 'primary_company', 'CUS-000001', 'Acme', 'currency_usd', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })

    it('the currency_id foreign key rejects a reference to a nonexistent currency', () => {
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
            `INSERT INTO customers (id, company_id, code, name, currency_id, is_active, created_at, updated_at)
             VALUES ('customer_1', 'primary_company', 'CUS-000001', 'Acme', 'does-not-exist', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })

    it('the customer_id foreign key on customer_contacts rejects a reference to a nonexistent customer', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)

      expect(() =>
        rawDb
          .prepare(
            `INSERT INTO customer_contacts (id, customer_id, name, is_active, created_at, updated_at)
             VALUES ('contact_1', 'does-not-exist', 'Jane', 1, ?, ?)`
          )
          .run(Date.now(), Date.now())
      ).toThrow(/FOREIGN KEY constraint failed/)

      rawDb.close()
    })
  })

  describe('upgrade from an approved Slice 13 database', () => {
    it('a database with only migrations 0000-0007 applied upgrades cleanly through 0008, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0007')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 8)

      // Simulate an approved Slice 13 install: only 0000-0007 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('customers')

      // Seed real Slice 5-13 data on this pre-Slice-14 database, via the
      // real, audit-writing service functions.
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
      const inventoryItem = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )
      const supplierNumberingNow = Date.now()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(supplierNumberingNow, supplierNumberingNow)
      const supplier = createSupplier(db, { name: 'Acme Foods' }, { type: 'system' })
      const price = recordSupplierPrice(
        db,
        {
          supplierId: supplier.id,
          inventoryItemId: inventoryItem.id,
          priceMinor: 500,
          effectiveFrom: new Date()
        },
        { type: 'system' }
      )

      const auditRowCountBeforeUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountBeforeUpgrade).toBeGreaterThan(0)

      // Now upgrade: apply the full, real migrations folder (0000-0008)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('customers')
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('customer_contacts')

      // This test manually seeds numbering rules rather than going
      // through the real first-run transaction, so the 'customer' rule
      // needs the same manual seed a real post-upgrade database would
      // already have from Slice 8.
      seedCustomerNumberingRule(rawDb)
      const customer = createCustomer(db, { name: 'Acme Retail' }, { type: 'system' })
      expect(customer.code).toBe('CUS-000001')
      const contact = createCustomerContact(
        db,
        { customerId: customer.id, name: 'Jane Doe' },
        { type: 'system' }
      )
      expect(contact.name).toBe('Jane Doe')

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

      const productRow = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(product.id) as
        { code: string } | undefined
      expect(productRow?.code).toBe('PRD-000001')

      const variantRow = rawDb
        .prepare('SELECT * FROM product_variants WHERE id = ?')
        .get(variant.id) as { code: string } | undefined
      expect(variantRow?.code).toBe('100ML')

      const itemRow = rawDb
        .prepare('SELECT * FROM inventory_items WHERE id = ?')
        .get(inventoryItem.id) as { code: string } | undefined
      expect(itemRow?.code).toBe('FLOUR')

      const supplierRow = rawDb.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier.id) as
        { code: string } | undefined
      expect(supplierRow?.code).toBe('SUP-000001')

      const priceRow = rawDb
        .prepare('SELECT * FROM supplier_item_prices WHERE id = ?')
        .get(price.id) as { price_minor: number } | undefined
      expect(priceRow?.price_minor).toBe(500)

      const auditRowCountAfterUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      // The upgrade itself adds no audit rows; creating the customer and
      // its contact afterward adds exactly 2 more.
      expect(auditRowCountAfterUpgrade).toBe(auditRowCountBeforeUpgrade + 2)

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0007 remain byte-identical to their state at the approved m1-slice-13 tag', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql',
        'migrations/0004_audit_logging.sql',
        'migrations/0005_products_and_variants.sql',
        'migrations/0006_inventory_items.sql',
        'migrations/0007_suppliers.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-13', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

describe('Slice 15 migration (0009_inventory_lots)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-migration-0009')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function seedInventoryLotNumberingRule(rawDb: ReturnType<typeof createDatabaseConnection>): void {
    const now = Date.now()
    rawDb
      .prepare(
        `INSERT INTO numbering_rules
           (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
           VALUES ('numbering_rule_inventory_lot', 'primary_company', 'inventory_lot', 'LOT', 6, 'never', 0, NULL, ?, ?)`
      )
      .run(now, now)
  }

  function seedFixtureItem(db: AppDb): string {
    return createInventoryItem(
      db,
      {
        code: 'FLOUR',
        name: 'Flour',
        category: 'Dry goods',
        itemType: 'ingredient',
        unitOfMeasureId: 'uom_kg',
        minimumStock: 0,
        reorderQuantity: 0,
        leadTimeDays: 0
      },
      { type: 'system' }
    ).id
  }

  describe('fresh database', () => {
    it('applies all migrations 0000-0009 cleanly, including inventory_lots and stock_movements', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tables = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tables.map((t) => t.name)).toContain('inventory_lots')
      expect(tables.map((t) => t.name)).toContain('stock_movements')

      rawDb.close()
    })

    it('applies all four expected indexes on stock_movements and one on inventory_lots', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const lotIndexes = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
        .all('inventory_lots') as SqliteIndexRow[]
      // The unique (company_id, internal_lot_number) constraint is
      // itself implemented as a unique index by SQLite.
      expect(lotIndexes.map((i) => i.name)).toContain(
        'inventory_lots_company_internal_lot_number_unique'
      )

      const movementIndexes = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?")
        .all('stock_movements') as SqliteIndexRow[]
      const movementIndexNames = movementIndexes.map((i) => i.name)
      expect(movementIndexNames).toContain('stock_movements_lot_history_idx')
      expect(movementIndexNames).toContain('stock_movements_reference_idx')
      expect(movementIndexNames).toContain('stock_movements_reversal_idx')
      expect(movementIndexNames).toContain('stock_movements_reversed_movement_id_unique')

      rawDb.close()
    })

    it('the inventory_lot numbering rule is available for allocation once seeded', () => {
      const rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
      seedReferenceData(rawDb)
      const db = drizzle<Record<string, never>>(rawDb) as AppDb
      createCompany(
        db,
        { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
        new Date()
      )
      seedInventoryLotNumberingRule(rawDb)
      const itemId = seedFixtureItem(db)

      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: itemId,
          receivedDate: new Date(),
          quantityReceivedScaled: 1000,
          unitCostMinor: 100
        },
        { type: 'system' }
      )
      expect(lot.internalLotNumber).toBe('LOT-000001')

      rawDb.close()
    })

    describe('inventory_lots CHECK constraints', () => {
      function insertBaseLot(
        rawDb: ReturnType<typeof createDatabaseConnection>,
        itemId: string,
        overrides: Record<string, string | number> = {}
      ): void {
        const fields = {
          id: `inventory_lot_${Math.random()}`,
          company_id: 'primary_company',
          inventory_item_id: itemId,
          received_date: Date.now(),
          quantity_received_scaled: 1000,
          quantity_remaining_scaled: 1000,
          unit_cost_minor: 100,
          total_cost_minor: 100000,
          cost_remaining_minor: 100000,
          currency_id: 'currency_usd',
          internal_lot_number: `LOT-${Math.floor(Math.random() * 1000000)}`,
          lifecycle_status: 'active',
          created_at: Date.now(),
          updated_at: Date.now(),
          ...overrides
        }
        const columns = Object.keys(fields).join(', ')
        const placeholders = Object.keys(fields)
          .map(() => '?')
          .join(', ')
        rawDb
          .prepare(`INSERT INTO inventory_lots (${columns}) VALUES (${placeholders})`)
          .run(...Object.values(fields))
      }

      let rawDb: ReturnType<typeof createDatabaseConnection>
      let db: AppDb
      let itemId: string

      beforeEach(() => {
        rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
        runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
        seedReferenceData(rawDb)
        db = drizzle<Record<string, never>>(rawDb) as AppDb
        createCompany(
          db,
          { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
          new Date()
        )
        itemId = seedFixtureItem(db)
      })

      afterEach(() => {
        rawDb.close()
      })

      it('rejects a non-primary company_id', () => {
        expect(() => insertBaseLot(rawDb, itemId, { company_id: 'someone_else' })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects a non-positive quantity_received_scaled', () => {
        expect(() => insertBaseLot(rawDb, itemId, { quantity_received_scaled: 0 })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects a negative quantity_remaining_scaled', () => {
        expect(() => insertBaseLot(rawDb, itemId, { quantity_remaining_scaled: -1 })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects quantity_remaining_scaled exceeding quantity_received_scaled', () => {
        expect(() =>
          insertBaseLot(rawDb, itemId, {
            quantity_received_scaled: 100,
            quantity_remaining_scaled: 101
          })
        ).toThrow(/CHECK constraint failed/)
      })

      it('rejects a negative unit_cost_minor', () => {
        expect(() => insertBaseLot(rawDb, itemId, { unit_cost_minor: -1 })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects a negative total_cost_minor', () => {
        expect(() => insertBaseLot(rawDb, itemId, { total_cost_minor: -1 })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects a negative cost_remaining_minor', () => {
        expect(() => insertBaseLot(rawDb, itemId, { cost_remaining_minor: -1 })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects cost_remaining_minor exceeding total_cost_minor', () => {
        expect(() =>
          insertBaseLot(rawDb, itemId, { total_cost_minor: 100, cost_remaining_minor: 101 })
        ).toThrow(/CHECK constraint failed/)
      })

      it('rejects an invalid lifecycle_status', () => {
        expect(() => insertBaseLot(rawDb, itemId, { lifecycle_status: 'bogus' })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('accepts each of the three valid lifecycle statuses', () => {
        expect(() => insertBaseLot(rawDb, itemId, { lifecycle_status: 'active' })).not.toThrow()
        expect(() =>
          insertBaseLot(rawDb, itemId, { lifecycle_status: 'quarantined' })
        ).not.toThrow()
        expect(() =>
          insertBaseLot(rawDb, itemId, {
            lifecycle_status: 'depleted',
            quantity_remaining_scaled: 0,
            cost_remaining_minor: 0
          })
        ).not.toThrow()
      })

      it('rejects a duplicate (company_id, internal_lot_number) pair', () => {
        insertBaseLot(rawDb, itemId, { internal_lot_number: 'LOT-000001' })
        expect(() => insertBaseLot(rawDb, itemId, { internal_lot_number: 'LOT-000001' })).toThrow(
          /UNIQUE constraint failed/
        )
      })

      it('the inventory_item_id foreign key rejects a reference to a nonexistent item', () => {
        expect(() => insertBaseLot(rawDb, itemId, { inventory_item_id: 'does-not-exist' })).toThrow(
          /FOREIGN KEY constraint failed/
        )
      })

      it('the supplier_id foreign key rejects a reference to a nonexistent supplier', () => {
        expect(() => insertBaseLot(rawDb, itemId, { supplier_id: 'does-not-exist' })).toThrow(
          /FOREIGN KEY constraint failed/
        )
      })

      it('the currency_id foreign key rejects a reference to a nonexistent currency', () => {
        expect(() => insertBaseLot(rawDb, itemId, { currency_id: 'does-not-exist' })).toThrow(
          /FOREIGN KEY constraint failed/
        )
      })

      it('the company_id foreign key rejects a reference to a nonexistent company', () => {
        // Standalone setup, deliberately never calling createCompany --
        // matching the established pattern from the Slice 14 suite's
        // own equivalent test. company_id is constrained by the
        // singleton CHECK to always equal 'primary_company', so the
        // only way to isolate the FK (as opposed to the CHECK) is to
        // attempt an insert referencing that exact id while no such
        // row actually exists yet.
        const standaloneRawDb = createDatabaseConnection(join(dir, 'standalone-company-fk.db'))
        runMigrations(standaloneRawDb, REAL_MIGRATIONS_FOLDER)
        seedReferenceData(standaloneRawDb)
        expect(() =>
          standaloneRawDb
            .prepare(
              `INSERT INTO inventory_lots
               (id, company_id, inventory_item_id, received_date, quantity_received_scaled, quantity_remaining_scaled, unit_cost_minor, total_cost_minor, cost_remaining_minor, currency_id, internal_lot_number, lifecycle_status, created_at, updated_at)
               VALUES ('lot_x', 'primary_company', 'does-not-exist', ?, 1000, 1000, 100, 100000, 100000, 'currency_usd', 'LOT-000001', 'active', ?, ?)`
            )
            .run(Date.now(), Date.now(), Date.now())
        ).toThrow(/FOREIGN KEY constraint failed/)
        standaloneRawDb.close()
      })
    })

    describe('stock_movements CHECK constraints and FKs', () => {
      let rawDb: ReturnType<typeof createDatabaseConnection>
      let db: AppDb
      let lotId: string

      beforeEach(() => {
        rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
        runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
        seedReferenceData(rawDb)
        db = drizzle<Record<string, never>>(rawDb) as AppDb
        createCompany(
          db,
          { name: 'X', address: 'Y', contactDetails: 'Z', currencyId: 'currency_usd' },
          new Date()
        )
        seedInventoryLotNumberingRule(rawDb)
        const itemId = seedFixtureItem(db)
        lotId = createOpeningLot(
          db,
          {
            inventoryItemId: itemId,
            receivedDate: new Date(),
            quantityReceivedScaled: 1000,
            unitCostMinor: 100
          },
          { type: 'system' }
        ).id
      })

      afterEach(() => {
        rawDb.close()
      })

      function insertBaseMovement(overrides: Record<string, string | number | null> = {}): void {
        const fields: Record<string, string | number | null> = {
          id: `stock_movement_${Math.random()}`,
          company_id: 'primary_company',
          inventory_lot_id: lotId,
          movement_type: 'adjustment',
          physical_quantity_delta_scaled: 100,
          reserved_quantity_delta_scaled: 0,
          cost_delta_minor: 0,
          reference_type: 'manual_adjustment',
          created_at: Date.now(),
          ...overrides
        }
        const columns = Object.keys(fields).join(', ')
        const placeholders = Object.keys(fields)
          .map(() => '?')
          .join(', ')
        rawDb
          .prepare(`INSERT INTO stock_movements (${columns}) VALUES (${placeholders})`)
          .run(...Object.values(fields))
      }

      it('rejects a non-primary company_id', () => {
        expect(() => insertBaseMovement({ company_id: 'someone_else' })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('rejects an invalid movement_type', () => {
        expect(() => insertBaseMovement({ movement_type: 'bogus' })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('accepts each of the six valid movement types', () => {
        for (const movementType of [
          'receipt',
          'consumption',
          'adjustment',
          'reservation',
          'release',
          'reversal'
        ]) {
          expect(() => insertBaseMovement({ movement_type: movementType })).not.toThrow()
        }
      })

      it('rejects an invalid reference_type', () => {
        expect(() => insertBaseMovement({ reference_type: 'bogus' })).toThrow(
          /CHECK constraint failed/
        )
      })

      it('accepts each of the seven valid reference types', () => {
        for (const referenceType of [
          'opening_stock',
          'manual_adjustment',
          'goods_receipt',
          'production',
          'sales',
          'reservation',
          'reversal'
        ]) {
          expect(() => insertBaseMovement({ reference_type: referenceType })).not.toThrow()
        }
      })

      it('rejects a movement with both physical and reserved deltas at zero', () => {
        expect(() =>
          insertBaseMovement({
            physical_quantity_delta_scaled: 0,
            reserved_quantity_delta_scaled: 0
          })
        ).toThrow(/CHECK constraint failed/)
      })

      it('accepts a movement with a nonzero reserved delta and a zero physical delta', () => {
        expect(() =>
          insertBaseMovement({
            physical_quantity_delta_scaled: 0,
            reserved_quantity_delta_scaled: 50
          })
        ).not.toThrow()
      })

      it('rejects a duplicate reversed_movement_id', () => {
        insertBaseMovement({ id: 'mv_original' })
        insertBaseMovement({ id: 'mv_reversal_1', reversed_movement_id: 'mv_original' })
        expect(() =>
          insertBaseMovement({ id: 'mv_reversal_2', reversed_movement_id: 'mv_original' })
        ).toThrow(/UNIQUE constraint failed/)
      })

      it('allows multiple movements with a NULL reversed_movement_id (NULLs are not considered duplicates)', () => {
        insertBaseMovement({ id: 'mv_a' })
        expect(() => insertBaseMovement({ id: 'mv_b' })).not.toThrow()
      })

      it('the inventory_lot_id foreign key rejects a reference to a nonexistent lot', () => {
        expect(() => insertBaseMovement({ inventory_lot_id: 'does-not-exist' })).toThrow(
          /FOREIGN KEY constraint failed/
        )
      })

      it('the reversed_movement_id foreign key rejects a reference to a nonexistent movement', () => {
        expect(() => insertBaseMovement({ reversed_movement_id: 'does-not-exist' })).toThrow(
          /FOREIGN KEY constraint failed/
        )
      })

      it('the company_id foreign key rejects a reference to a nonexistent company', () => {
        // Standalone setup, deliberately never calling createCompany --
        // same reasoning as inventory_lots' own equivalent test above.
        const standaloneRawDb = createDatabaseConnection(join(dir, 'standalone-company-fk-2.db'))
        runMigrations(standaloneRawDb, REAL_MIGRATIONS_FOLDER)
        seedReferenceData(standaloneRawDb)
        expect(() =>
          standaloneRawDb
            .prepare(
              `INSERT INTO stock_movements
               (id, company_id, inventory_lot_id, movement_type, physical_quantity_delta_scaled, reserved_quantity_delta_scaled, cost_delta_minor, reference_type, created_at)
               VALUES ('mv_x', 'primary_company', 'does-not-exist', 'adjustment', 100, 0, 0, 'manual_adjustment', ?)`
            )
            .run(Date.now())
        ).toThrow(/FOREIGN KEY constraint failed/)
        standaloneRawDb.close()
      })

      it('a movement can be reversed via the real service, and the reversal round-trips through these same constraints', () => {
        const original = recordAdjustment(
          db,
          {
            inventoryLotId: lotId,
            physicalQuantityDeltaScaled: -100,
            costDeltaMinor: -10,
            reason: 'Test adjustment'
          },
          { type: 'system' }
        )
        const reversal = reverseMovement(db, original.id, 'Undo test adjustment', {
          type: 'system'
        })
        expect(reversal.physicalQuantityDeltaScaled).toBe(100)
        expect(reversal.reversedMovementId).toBe(original.id)
      })
    })
  })

  describe('upgrade from the imported Slice 14 baseline', () => {
    it('a database with only migrations 0000-0008 applied upgrades cleanly through 0009, preserving all existing data', async () => {
      const dbPath = join(dir, 'ledgerpage.db')
      const truncatedMigrationsDir = join(dir, 'migrations-through-0008')
      buildTruncatedMigrationsFolder(REAL_MIGRATIONS_FOLDER, truncatedMigrationsDir, 9)

      // Simulate the imported, verified Slice 14 baseline: only
      // 0000-0008 applied.
      const rawDb = createDatabaseConnection(dbPath)
      runMigrations(rawDb, truncatedMigrationsDir)

      const tablesBeforeUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('inventory_lots')
      expect(tablesBeforeUpgrade.map((t) => t.name)).not.toContain('stock_movements')

      // Seed real Slice 5-14 data on this pre-Slice-15 database, via
      // the real, audit-writing service functions.
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
      const inventoryItem = createInventoryItem(
        db,
        {
          code: 'FLOUR',
          name: 'Flour',
          category: 'Dry goods',
          itemType: 'ingredient',
          unitOfMeasureId: 'uom_kg',
          minimumStock: 0,
          reorderQuantity: 0,
          leadTimeDays: 0
        },
        { type: 'system' }
      )
      const supplierNumberingNow = Date.now()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_supplier', 'primary_company', 'supplier', 'SUP', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(supplierNumberingNow, supplierNumberingNow)
      const supplier = createSupplier(db, { name: 'Acme Foods' }, { type: 'system' })
      const price = recordSupplierPrice(
        db,
        {
          supplierId: supplier.id,
          inventoryItemId: inventoryItem.id,
          priceMinor: 500,
          effectiveFrom: new Date()
        },
        { type: 'system' }
      )
      const customerNumberingNow = Date.now()
      rawDb
        .prepare(
          `INSERT INTO numbering_rules
             (id, company_id, document_type_key, prefix, padding_length, reset_behavior, current_sequence_value, current_sequence_year, created_at, updated_at)
             VALUES ('numbering_rule_customer', 'primary_company', 'customer', 'CUS', 6, 'never', 0, NULL, ?, ?)`
        )
        .run(customerNumberingNow, customerNumberingNow)
      const customer = createCustomer(db, { name: 'Acme Retail' }, { type: 'system' })
      const contact = createCustomerContact(
        db,
        { customerId: customer.id, name: 'Jane Doe' },
        { type: 'system' }
      )

      const auditRowCountBeforeUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      expect(auditRowCountBeforeUpgrade).toBeGreaterThan(0)

      // Now upgrade: apply the full, real migrations folder (0000-0009)
      // against this same, already-populated database file.
      runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)

      const tablesAfterUpgrade = rawDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as SqliteTableRow[]
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('inventory_lots')
      expect(tablesAfterUpgrade.map((t) => t.name)).toContain('stock_movements')

      // This test manually seeds numbering rules rather than going
      // through the real first-run transaction, so the 'inventory_lot'
      // rule needs the same explicit seed a real post-upgrade database
      // would already have from Slice 8.
      seedInventoryLotNumberingRule(rawDb)
      const lot = createOpeningLot(
        db,
        {
          inventoryItemId: inventoryItem.id,
          receivedDate: new Date(),
          quantityReceivedScaled: 20000,
          unitCostMinor: 350
        },
        { type: 'system' }
      )
      expect(lot.internalLotNumber).toBe('LOT-000001')
      expect(lot.totalCostMinor).toBe(7000)

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

      const productRow = rawDb.prepare('SELECT * FROM products WHERE id = ?').get(product.id) as
        { code: string } | undefined
      expect(productRow?.code).toBe('PRD-000001')

      const variantRow = rawDb
        .prepare('SELECT * FROM product_variants WHERE id = ?')
        .get(variant.id) as { code: string } | undefined
      expect(variantRow?.code).toBe('100ML')

      const itemRow = rawDb
        .prepare('SELECT * FROM inventory_items WHERE id = ?')
        .get(inventoryItem.id) as { code: string } | undefined
      expect(itemRow?.code).toBe('FLOUR')

      const supplierRow = rawDb.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplier.id) as
        { code: string } | undefined
      expect(supplierRow?.code).toBe('SUP-000001')

      const priceRow = rawDb
        .prepare('SELECT * FROM supplier_item_prices WHERE id = ?')
        .get(price.id) as { price_minor: number } | undefined
      expect(priceRow?.price_minor).toBe(500)

      const customerRow = rawDb.prepare('SELECT * FROM customers WHERE id = ?').get(customer.id) as
        { code: string } | undefined
      expect(customerRow?.code).toBe('CUS-000001')

      const contactRow = rawDb
        .prepare('SELECT * FROM customer_contacts WHERE id = ?')
        .get(contact.id) as { name: string } | undefined
      expect(contactRow?.name).toBe('Jane Doe')

      const auditRowCountAfterUpgrade = (
        rawDb.prepare('SELECT COUNT(*) as count FROM audit_log_entries').get() as {
          count: number
        }
      ).count
      // The upgrade itself adds no audit rows; creating the lot
      // afterward adds exactly 2 more (one for the lot, one for its
      // initial receipt movement).
      expect(auditRowCountAfterUpgrade).toBe(auditRowCountBeforeUpgrade + 2)

      rawDb.close()
    }, 20000)
  })

  describe('no pre-existing migration was modified', () => {
    it('migrations 0000-0008 remain byte-identical to their state at the imported m1-slice-14 baseline', () => {
      const filesToCheck = [
        'migrations/0000_reference_data_tables.sql',
        'migrations/0001_company_and_numbering_rules.sql',
        'migrations/0002_tax_configuration.sql',
        'migrations/0003_authentication_foundations.sql',
        'migrations/0004_audit_logging.sql',
        'migrations/0005_products_and_variants.sql',
        'migrations/0006_inventory_items.sql',
        'migrations/0007_suppliers.sql',
        'migrations/0008_customers.sql'
      ]

      const diffOutput = execFileSync('git', ['diff', 'm1-slice-14', '--', ...filesToCheck], {
        cwd: process.cwd(),
        encoding: 'utf-8'
      })

      expect(diffOutput.trim()).toBe('')
    })
  })
})

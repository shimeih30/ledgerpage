import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedReferenceData } from '../../../src/main/db/seedReferenceData'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { currencySeedRows } from '../../../src/main/db/seedData/currencies'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const EXPECTED_TABLES = [
  'users',
  'roles',
  'user_roles',
  'owner_recovery_credentials',
  'login_events'
]

describe('Slice 7 authentication schema (real migrations folder)', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-slice7-schema')
    dbPath = join(dir, 'ledgerpage.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  function migratedDb() {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    return db
  }

  function seedCompanyAndCurrency(db: ReturnType<typeof migratedDb>) {
    seedReferenceData(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO company (id, name, address, contact_details, currency_id, created_at, updated_at) VALUES ('primary_company','Fixture Co','Addr','Contact','currency_usd',?,?)"
    ).run(now, now)
  }

  it.each(EXPECTED_TABLES)('creates the %s table', (tableName) => {
    const db = migratedDb()
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    expect(tables.map((t) => t.name)).toContain(tableName)
    db.close()
  })

  it('users has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'company_id',
        'login_identifier',
        'display_name',
        'password_hash',
        'password_changed_at',
        'is_active',
        'failed_login_count',
        'locked_until',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('roles has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(roles)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'code',
        'name',
        'description',
        'is_system',
        'created_at',
        'updated_at'
      ])
    )
    db.close()
  })

  it('user_roles has the expected columns and composite primary key', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(user_roles)').all() as {
      name: string
      pk: number
    }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['user_id', 'role_id', 'created_at'])
    )
    const pkColumns = columns.filter((c) => c.pk > 0).map((c) => c.name)
    expect(pkColumns.sort()).toEqual(['role_id', 'user_id'])
    db.close()
  })

  it('owner_recovery_credentials has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(owner_recovery_credentials)').all() as {
      name: string
    }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining([
        'id',
        'user_id',
        'recovery_key_hash',
        'version',
        'is_active',
        'created_at',
        'revoked_at'
      ])
    )
    db.close()
  })

  it('login_events has the expected columns', () => {
    const db = migratedDb()
    const columns = db.prepare('PRAGMA table_info(login_events)').all() as { name: string }[]
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['id', 'user_id', 'occurred_at', 'success', 'source'])
    )
    db.close()
  })

  it('users.company_id references company(id)', () => {
    const db = migratedDb()
    const fks = db.prepare('PRAGMA foreign_key_list(users)').all() as {
      table: string
      to: string
    }[]
    expect(fks.some((fk) => fk.table === 'company' && fk.to === 'id')).toBe(true)
    db.close()
  })

  it('user_roles references both users(id) and roles(id)', () => {
    const db = migratedDb()
    const fks = db.prepare('PRAGMA foreign_key_list(user_roles)').all() as {
      table: string
      to: string
    }[]
    expect(fks.some((fk) => fk.table === 'users')).toBe(true)
    expect(fks.some((fk) => fk.table === 'roles')).toBe(true)
    db.close()
  })

  it('enforces login identifier uniqueness within a company', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u1','primary_company','ben','Ben','hash',?,?,?)"
    ).run(now, now, now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u2','primary_company','ben','Ben Two','hash2',?,?,?)"
        )
        .run(now, now, now)
    ).toThrow(/UNIQUE constraint failed/i)
    db.close()
  })

  it('enforces user_roles uniqueness on (user_id, role_id)', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    seedRoles(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u1','primary_company','ben','Ben','hash',?,?,?)"
    ).run(now, now, now)
    db.prepare('INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)').run(
      'u1',
      'role_owner',
      now
    )

    expect(() =>
      db
        .prepare('INSERT INTO user_roles (user_id, role_id, created_at) VALUES (?, ?, ?)')
        .run('u1', 'role_owner', now)
    ).toThrow(/UNIQUE constraint failed|PRIMARY KEY/i)
    db.close()
  })

  it('enforces recovery credential version must be positive', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u1','primary_company','ben','Ben','hash',?,?,?)"
    ).run(now, now, now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1','u1','hash',0,1,?)"
        )
        .run(now)
    ).toThrow(/CHECK constraint failed/i)
    db.close()
  })

  it('the partial unique index allows only one active recovery credential per user', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()
    db.prepare(
      "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u1','primary_company','ben','Ben','hash',?,?,?)"
    ).run(now, now, now)
    db.prepare(
      "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc1','u1','hash1',1,1,?)"
    ).run(now)

    expect(() =>
      db
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at) VALUES ('rc2','u1','hash2',2,1,?)"
        )
        .run(now)
    ).toThrow(/UNIQUE constraint failed/i)

    // A second INACTIVE credential is fine — history, not a live duplicate.
    expect(() =>
      db
        .prepare(
          "INSERT INTO owner_recovery_credentials (id, user_id, recovery_key_hash, version, is_active, created_at, revoked_at) VALUES ('rc3','u1','hash3',2,0,?,?)"
        )
        .run(now, now)
    ).not.toThrow()

    db.close()
  })

  it('rejects an unsupported login_events source value', () => {
    const db = migratedDb()
    seedCompanyAndCurrency(db)
    const now = Date.now()

    expect(() =>
      db
        .prepare(
          "INSERT INTO login_events (id, user_id, occurred_at, success, source) VALUES ('le1',NULL,?,0,'password_reset')"
        )
        .run(now)
    ).toThrow(/CHECK constraint failed/i)
    db.close()
  })

  it('runs successfully against a fresh (empty) database', () => {
    expect(() => migratedDb()).not.toThrow()
  })

  it('upgrades an existing Slice 6 database (all four migrations applied from the real folder)', () => {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const names = tables.map((t) => t.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'currencies',
        'units_of_measure',
        'payment_methods',
        'expense_categories',
        'company',
        'numbering_rules',
        'tax_codes',
        'tax_rate_versions',
        ...EXPECTED_TABLES
      ])
    )
    db.close()
  })

  it('preserves existing Slice 4-6 data when the Slice 7 migration is applied', () => {
    const db = createDatabaseConnection(dbPath)
    runMigrations(db, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(db)

    const count = (db.prepare('SELECT COUNT(*) as c FROM currencies').get() as { c: number }).c
    expect(count).toBe(currencySeedRows.length)
    db.close()
  })

  it('seeds the four fixed roles exactly once, even if seedRoles runs twice', () => {
    const db = migratedDb()
    seedRoles(db)
    seedRoles(db)

    const rows = db.prepare('SELECT code FROM roles ORDER BY code').all() as { code: string }[]
    expect(rows.map((r) => r.code)).toEqual(['executive', 'finance', 'operations', 'owner'])
    db.close()
  })

  it('re-seeding roles never overwrites an edited name/description', () => {
    const db = migratedDb()
    seedRoles(db)
    db.prepare("UPDATE roles SET name = 'Edited Owner Name' WHERE id = 'role_owner'").run()

    seedRoles(db)

    const row = db.prepare('SELECT name FROM roles WHERE id = ?').get('role_owner') as {
      name: string
    }
    expect(row.name).toBe('Edited Owner Name')
    db.close()
  })

  it('leaves users, user_roles, owner_recovery_credentials, and login_events empty after normal startup', () => {
    const db = migratedDb()
    seedReferenceData(db)
    seedRoles(db)

    for (const table of ['users', 'user_roles', 'owner_recovery_credentials', 'login_events']) {
      const count = (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c
      expect(count).toBe(0)
    }
    db.close()
  })

  it('keeps foreign_keys enabled after migrating in the new tables', () => {
    const db = migratedDb()
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('does not modify migrations 0000, 0001, or 0002', () => {
    const slice4Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0000_reference_data_tables.sql'),
      'utf-8'
    )
    const slice5Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0001_company_and_numbering_rules.sql'),
      'utf-8'
    )
    const slice6Sql = readFileSync(
      join(REAL_MIGRATIONS_FOLDER, '0002_tax_configuration.sql'),
      'utf-8'
    )
    expect(slice4Sql).not.toContain('users')
    expect(slice5Sql).not.toContain('CREATE TABLE `users`')
    expect(slice6Sql).not.toContain('CREATE TABLE `users`')
  })
})

import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/runMigrations'
import { seedRoles } from '../../../src/main/db/seedRoles'
import { roleSeedRows } from '../../../src/main/db/seedData/roles'
import { createTempDir, removeTempDir } from '../../helpers/tempDir'

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')

describe('seedRoles', () => {
  let dir: string
  let dbPath: string
  let rawDb: ReturnType<typeof createDatabaseConnection>

  beforeEach(() => {
    dir = createTempDir('ledgerpage-seed-roles')
    dbPath = join(dir, 'ledgerpage.db')
    rawDb = createDatabaseConnection(dbPath)
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  it('inserts exactly the four approved roles with their exact seed data', () => {
    seedRoles(rawDb)

    for (const row of roleSeedRows) {
      const stored = rawDb
        .prepare('SELECT id, code, name, description, is_system FROM roles WHERE id = ?')
        .get(row.id) as {
        id: string
        code: string
        name: string
        description: string | null
        is_system: number
      }
      expect(stored).toEqual({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        is_system: 1
      })
    }

    const count = (rawDb.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c
    expect(count).toBe(roleSeedRows.length)
  })

  it('is idempotent: running it many times never creates duplicates', () => {
    seedRoles(rawDb)
    seedRoles(rawDb)
    seedRoles(rawDb)

    const count = (rawDb.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c
    expect(count).toBe(roleSeedRows.length)
  })

  it('never overwrites an edited description on re-seed', () => {
    seedRoles(rawDb)
    rawDb
      .prepare("UPDATE roles SET description = 'Custom description' WHERE id = 'role_finance'")
      .run()

    seedRoles(rawDb)

    const row = rawDb.prepare('SELECT description FROM roles WHERE id = ?').get('role_finance') as {
      description: string
    }
    expect(row.description).toBe('Custom description')
  })

  it('runs transactionally: a failure partway through leaves no partial rows', () => {
    // Force a failure by inserting a role with a conflicting *code* (not
    // id) before seeding — onConflictDoNothing targets id, so a
    // same-code-different-id row hits the UNIQUE(code) constraint
    // instead, which is not suppressed, and the whole seeding
    // transaction should roll back rather than leave the other three
    // roles partially inserted.
    const now = Date.now()
    rawDb
      .prepare('INSERT INTO roles (id, code, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('some_other_id', 'owner', 'Conflicting Owner', now, now)

    expect(() => seedRoles(rawDb)).toThrow()

    const count = (rawDb.prepare('SELECT COUNT(*) as c FROM roles').get() as { c: number }).c
    // Only the one pre-existing conflicting row — none of the four
    // intended roles were partially inserted before the failure.
    expect(count).toBe(1)
  })
})

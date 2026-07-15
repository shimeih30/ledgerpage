import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { createTempDir, isOutsideSourceTree, removeTempDir } from '../helpers/tempDir'

describe('createDatabaseConnection', () => {
  let dir: string
  let dbPath: string

  beforeEach(() => {
    dir = createTempDir('ledgerpage-db')
    dbPath = join(dir, 'ledgerpage.db')
  })

  afterEach(() => {
    removeTempDir(dir)
  })

  it('is created in an isolated temp location, outside the source tree', () => {
    expect(isOutsideSourceTree(dbPath)).toBe(true)
  })

  it('creates the database file on first launch', () => {
    expect(existsSync(dbPath)).toBe(false)
    const db = createDatabaseConnection(dbPath)
    expect(existsSync(dbPath)).toBe(true)
    db.close()
  })

  it('reopens an existing database without error, preserving prior data', () => {
    const first = createDatabaseConnection(dbPath)
    first.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value TEXT)')
    first.prepare('INSERT INTO probe (value) VALUES (?)').run('hello')
    first.close()

    const second = createDatabaseConnection(dbPath)
    const row = second.prepare('SELECT value FROM probe WHERE id = 1').get() as { value: string }
    expect(row.value).toBe('hello')
    second.close()
  })

  it('enables WAL journal mode', () => {
    const db = createDatabaseConnection(dbPath)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    db.close()
  })

  it('enables foreign key enforcement', () => {
    const db = createDatabaseConnection(dbPath)
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('configures the default busy timeout', () => {
    const db = createDatabaseConnection(dbPath)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    db.close()
  })

  it('allows overriding the busy timeout', () => {
    const db = createDatabaseConnection(dbPath, { busyTimeoutMs: 1234 })
    expect(db.pragma('busy_timeout', { simple: true })).toBe(1234)
    db.close()
  })

  it('re-applies foreign_keys on every new connection, since SQLite scopes it per-connection', () => {
    const first = createDatabaseConnection(dbPath)
    first.close()

    // A brand new connection to the same file must not silently inherit
    // foreign key enforcement from the previous connection.
    const second = createDatabaseConnection(dbPath)
    expect(second.pragma('foreign_keys', { simple: true })).toBe(1)
    second.close()
  })

  describe('busyTimeoutMs validation', () => {
    it.each([
      ['a negative integer', -1],
      ['a non-integer number', 1.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['-Infinity', -Infinity]
    ])('rejects %s without creating a database file', (_label, value) => {
      expect(() => createDatabaseConnection(dbPath, { busyTimeoutMs: value })).toThrow(RangeError)
      expect(existsSync(dbPath)).toBe(false)
    })

    it('accepts zero as a valid busy timeout', () => {
      const db = createDatabaseConnection(dbPath, { busyTimeoutMs: 0 })
      expect(db.pragma('busy_timeout', { simple: true })).toBe(0)
      db.close()
    })
  })

  describe('cleanup when pragma configuration fails', () => {
    it('closes the connection and rethrows if the file is not a valid SQLite database', () => {
      // A real, practical way to trigger a pragma failure after a
      // successful open: better-sqlite3 opens the file handle lazily and
      // only discovers an invalid format once a pragma/query touches it.
      writeFileSync(dbPath, 'this is not a valid sqlite database file')

      expect(() => createDatabaseConnection(dbPath)).toThrow(/file is not a database/i)

      // The connection must not be left open/leaked after the failure —
      // verified indirectly: a fresh attempt against the same (still
      // invalid) file fails the same way rather than hanging or
      // reporting a file-already-in-use type error.
      expect(() => createDatabaseConnection(dbPath)).toThrow(/file is not a database/i)
    })
  })
})

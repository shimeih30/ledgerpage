import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureAppDataDirectories, resolveAppDataPaths } from '../../src/main/paths/appDataPaths'
import { createTempDir, isOutsideSourceTree, removeTempDir } from '../helpers/tempDir'

describe('resolveAppDataPaths', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = createTempDir('ledgerpage-paths')
  })

  afterEach(() => {
    removeTempDir(baseDir)
  })

  it('resolves an isolated temporary base directory, outside the source tree', () => {
    expect(isOutsideSourceTree(baseDir)).toBe(true)
  })

  it('computes the database directory and file path under the base directory', () => {
    const paths = resolveAppDataPaths(baseDir)
    expect(paths.database).toBe(join(baseDir, 'database'))
    expect(paths.databaseFile).toBe(join(baseDir, 'database', 'ledgerpage.db'))
  })

  it('computes backups, assets, and logs directories under the base directory', () => {
    const paths = resolveAppDataPaths(baseDir)
    expect(paths.backups).toBe(join(baseDir, 'backups'))
    expect(paths.assets).toBe(join(baseDir, 'assets'))
    expect(paths.logs).toBe(join(baseDir, 'logs'))
  })

  it('does not touch the filesystem — pure computation only', () => {
    resolveAppDataPaths(baseDir)
    expect(existsSync(join(baseDir, 'database'))).toBe(false)
  })
})

describe('ensureAppDataDirectories', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = createTempDir('ledgerpage-dirs')
  })

  afterEach(() => {
    removeTempDir(baseDir)
  })

  it('creates all four managed directories', () => {
    const paths = resolveAppDataPaths(baseDir)
    ensureAppDataDirectories(paths)

    for (const dir of [paths.database, paths.backups, paths.assets, paths.logs]) {
      expect(existsSync(dir)).toBe(true)
      expect(statSync(dir).isDirectory()).toBe(true)
    }
  })

  it('is idempotent — calling it twice does not throw', () => {
    const paths = resolveAppDataPaths(baseDir)
    ensureAppDataDirectories(paths)
    expect(() => ensureAppDataDirectories(paths)).not.toThrow()
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER_SRC_DIR = join(process.cwd(), 'src', 'renderer')

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }

  return files
}

/**
 * Anything that would let renderer code reach the database directly,
 * bypassing the (nonexistent, by design) preload/IPC boundary entirely.
 * A static text check rather than a bundler/type-level rule — simple,
 * dependency-free, and it reads the actual files that ship.
 */
const FORBIDDEN_IMPORT_PATTERNS: RegExp[] = [
  /from\s+['"]better-sqlite3['"]/,
  /require\(\s*['"]better-sqlite3['"]\s*\)/,
  /from\s+['"]drizzle-orm/,
  /require\(\s*['"]drizzle-orm/,
  /from\s+['"].*\/main\/db\//,
  /from\s+['"]\.\.\/\.\.\/main\//
]

describe('renderer does not import main-process database modules', () => {
  const rendererFiles = collectSourceFiles(RENDERER_SRC_DIR)

  it('found at least one renderer source file to check (sanity check for this test itself)', () => {
    expect(rendererFiles.length).toBeGreaterThan(0)
  })

  it.each(rendererFiles)('%s contains no forbidden database import', (filePath) => {
    const content = readFileSync(filePath, 'utf-8')

    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      expect(pattern.test(content)).toBe(false)
    }
  })
})

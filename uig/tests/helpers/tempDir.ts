import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Creates a fresh, disposable temporary directory under the OS temp
 * directory for a single test. Never inside the repository — tests must
 * not read or write real application data.
 */
export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`))
}

export function removeTempDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Asserts a path is genuinely outside the source tree (under the OS temp
 * directory), so tests fail loudly if a fixture accidentally resolves
 * into the repository instead of a disposable location.
 */
export function isOutsideSourceTree(candidatePath: string): boolean {
  return candidatePath.startsWith(tmpdir()) && !candidatePath.startsWith(process.cwd())
}

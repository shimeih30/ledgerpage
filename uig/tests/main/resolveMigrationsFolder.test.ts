import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveMigrationsFolder } from '../../src/main/db/resolveMigrationsFolder'

describe('resolveMigrationsFolder', () => {
  it('resolves two levels up from the compiled main entry (out/main -> project root/migrations)', () => {
    const mainDirname = '/app/out/main'
    expect(resolveMigrationsFolder(mainDirname)).toBe(join('/app', 'migrations'))
  })
})

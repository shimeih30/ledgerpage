import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import vm from 'node:vm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const PRELOAD_OUTPUT_PATH = join(process.cwd(), 'out', 'preload', 'index.js')

/**
 * Slice 4 corrective patch: a real Electron launch showed the preload
 * script failing to load under `sandbox: true` with
 * "SyntaxError: Cannot use import statement outside a module". Electron's
 * sandboxed preload loader evaluates the script as a classic (non-ESM)
 * script, regardless of the project's package.json "type" field — so
 * top-level `import`/`export` syntax is a hard parse error there even
 * though the exact same file is valid as an ES module under Node.
 *
 * These tests run a real build (not a synthetic fixture) and check the
 * actual artifact that ships, using node:vm's classic-script parser —
 * which reproduces the exact failure mode above — rather than only a
 * text-pattern check.
 */
describe('preload build output (sandbox-compatible CommonJS)', () => {
  beforeAll(() => {
    execSync('pnpm exec electron-vite build', { cwd: process.cwd(), stdio: 'pipe' })
  }, 60_000)

  it('produces out/preload/index.js', () => {
    expect(existsSync(PRELOAD_OUTPUT_PATH)).toBe(true)
  })

  it('contains no top-level import statement', () => {
    const source = readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8')
    expect(/^\s*import\s/m.test(source)).toBe(false)
  })

  it('contains no top-level export statement', () => {
    const source = readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8')
    expect(/^\s*export\s/m.test(source)).toBe(false)
  })

  it('parses successfully as a classic (non-ESM) script — reproduces how Electron loads a sandboxed preload', () => {
    const source = readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8')
    expect(() => new vm.Script(source, { filename: PRELOAD_OUTPUT_PATH })).not.toThrow()
  })

  it('reaches the electron module via require(), not import', () => {
    const source = readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8')
    expect(source).toContain('require("electron")')
  })

  it('does not bundle better-sqlite3 or any other filesystem/database dependency', () => {
    const source = readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8')
    expect(source).not.toContain('better-sqlite3')
    expect(source).not.toContain('drizzle-orm')
  })

  describe('when actually require()-d with electron mocked', () => {
    // Node determines module type by file extension + the nearest
    // package.json "type" field, not by sniffing content — so requiring
    // out/preload/index.js directly here (inside this "type": "module"
    // package) fails with a *different* error than Electron's real
    // sandboxed preload loader produces (which ignores package.json
    // "type" entirely — proven above via vm.Script). Copying the exact
    // same content to a .cjs file forces Node to load it as CommonJS,
    // letting this sub-suite actually execute the real built content and
    // verify its behavior, without that unrelated extension rule getting
    // in the way.
    const cjsCopyPath = join(process.cwd(), 'out', 'preload', 'index.cjs-test-copy.cjs')
    const moduleRequire = createRequire(import.meta.url)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ModuleCtor = moduleRequire('node:module') as any
    const originalResolveFilename = ModuleCtor._resolveFilename

    let exposedNamespace: string | undefined
    let exposedApi: Record<string, unknown> | undefined
    let invokedChannel: string | undefined

    beforeAll(() => {
      writeFileSync(cjsCopyPath, readFileSync(PRELOAD_OUTPUT_PATH, 'utf-8'))

      const mockElectron = {
        contextBridge: {
          exposeInMainWorld: (namespace: string, api: Record<string, unknown>) => {
            exposedNamespace = namespace
            exposedApi = api
          }
        },
        ipcRenderer: {
          invoke: (channel: string) => {
            invokedChannel = channel
            return Promise.resolve(undefined)
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ModuleCtor._resolveFilename = function (request: string, ...args: any[]) {
        if (request === 'electron') {
          return 'electron'
        }
        return originalResolveFilename.apply(ModuleCtor, [request, ...args])
      }
      moduleRequire.cache['electron'] = {
        id: 'electron',
        filename: 'electron',
        loaded: true,
        exports: mockElectron
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      moduleRequire(cjsCopyPath)
    })

    afterAll(() => {
      ModuleCtor._resolveFilename = originalResolveFilename
      delete moduleRequire.cache['electron']
      delete moduleRequire.cache[cjsCopyPath]
      rmSync(cjsCopyPath, { force: true })
    })

    it('exposes exactly one namespace: ledgerpage', () => {
      expect(exposedNamespace).toBe('ledgerpage')
    })

    it('exposes exactly the approved app-info + Slice 8/9 API — the narrow surface is preserved exactly', () => {
      expect(exposedApi ? Object.keys(exposedApi).sort() : []).toEqual(
        [
          'getAppInfo',
          'getFirstRunStatus',
          'prepareRecoveryKey',
          'confirmRecoveryKey',
          'cancelRecoveryKey',
          'completeSetup',
          'login',
          'getSessionState',
          'unlockSession',
          'logout',
          'touchSession',
          'listUsers',
          'createUser',
          'deactivateUser',
          'reactivateUser',
          'listAssignableRoles'
        ].sort()
      )
    })

    it('getAppInfo invokes exactly the app-info channel', async () => {
      expect(exposedApi).toBeDefined()
      await (exposedApi?.getAppInfo as () => Promise<unknown>)()
      expect(invokedChannel).toBe('app:get-info')
    })
  })
})

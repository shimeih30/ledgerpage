import { join } from 'node:path'

/**
 * Resolves the migrations folder for an unpackaged app (dev, or
 * `electron-vite preview`): the compiled main entry lives at
 * `out/main/index.js`, so the project's `migrations/` folder is two
 * levels up.
 *
 * KNOWN GAP: this does not yet handle a packaged (asar) build. A packaged
 * app needs the migrations folder bundled as an extra resource (e.g. via
 * electron-builder's `extraResources`) and resolved via
 * `process.resourcesPath` instead. That is deferred to the packaging
 * milestone, which is out of scope for this slice — flagging it here so
 * it isn't silently forgotten.
 */
export function resolveMigrationsFolder(mainDirname: string): string {
  return join(mainDirname, '../../migrations')
}

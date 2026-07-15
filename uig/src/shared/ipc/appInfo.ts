/**
 * Shared IPC contract for the single allow-listed channel in Slice 2.
 *
 * This file is imported by both the main process (to register the handler)
 * and the preload script (to wrap it safely) and the renderer (to type the
 * exposed window.ledgerpage global). It intentionally carries no database,
 * authentication or business-logic types.
 */

export const APP_INFO_CHANNEL = 'app:get-info' as const

export interface AppInfo {
  name: string
  version: string
  platform: string
}

/**
 * The full typed surface exposed to the renderer via contextBridge.
 * Keep this list exactly in sync with what src/preload/index.ts exposes —
 * tests assert the two never drift apart.
 */
export interface LedgerPageApi {
  getAppInfo: () => Promise<AppInfo>
}

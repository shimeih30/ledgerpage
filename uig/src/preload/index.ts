import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, type AppInfo, type LedgerPageApi } from '../shared/ipc/appInfo'

/**
 * The entire renderer-facing API for LedgerPage, so far.
 *
 * Deliberately tiny: one no-argument, read-only call. This exists to prove
 * the contextBridge pattern works end to end (main handler -> preload ->
 * renderer), not to provide real application capability. Do not add
 * additional keys here without updating LedgerPageApi in
 * src/shared/ipc/appInfo.ts and the corresponding tests.
 */
const api: LedgerPageApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL)
}

contextBridge.exposeInMainWorld('ledgerpage', api)

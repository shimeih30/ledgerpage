import { contextBridge, ipcRenderer } from 'electron'
import { APP_INFO_CHANNEL, type AppInfo, type LedgerPageApi } from '../shared/ipc/appInfo'
import {
  SETUP_CANCEL_RECOVERY_KEY_CHANNEL,
  SETUP_COMPLETE_CHANNEL,
  SETUP_CONFIRM_RECOVERY_KEY_CHANNEL,
  SETUP_GET_STATUS_CHANNEL,
  SETUP_PREPARE_RECOVERY_KEY_CHANNEL,
  type CancelRecoveryKeyInput,
  type CompleteSetupInput,
  type CompleteSetupResult,
  type ConfirmRecoveryKeyInput,
  type ConfirmRecoveryKeyResult,
  type FirstRunStatus,
  type LedgerPageSetupApi,
  type PrepareRecoveryKeyResult
} from '../shared/ipc/setup'

/**
 * The entire renderer-facing API for LedgerPage.
 *
 * getAppInfo: proves the contextBridge pattern works end to end, not
 * real application capability (Slice 2).
 *
 * The five setup:* methods are Slice 8's narrow, immutable first-run
 * surface — nothing beyond these five operations, and nothing on any
 * of them beyond what src/shared/ipc/setup.ts's types describe.
 * Deliberately absent, on every one of these: a database handle,
 * arbitrary SQL, filesystem access, a password hash, a recovery hash,
 * role mutation, a general user-management API, raw session mutation,
 * or any way to invoke anything else in the main process. Do not add
 * additional keys here without updating LedgerPageApi/LedgerPageSetupApi
 * in src/shared/ipc/ and the corresponding tests.
 */
const api: LedgerPageApi & LedgerPageSetupApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),

  getFirstRunStatus: (): Promise<FirstRunStatus> => ipcRenderer.invoke(SETUP_GET_STATUS_CHANNEL),

  prepareRecoveryKey: (): Promise<PrepareRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_PREPARE_RECOVERY_KEY_CHANNEL),

  confirmRecoveryKey: (input: ConfirmRecoveryKeyInput): Promise<ConfirmRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_CONFIRM_RECOVERY_KEY_CHANNEL, input),

  cancelRecoveryKey: (input: CancelRecoveryKeyInput): Promise<void> =>
    ipcRenderer.invoke(SETUP_CANCEL_RECOVERY_KEY_CHANNEL, input),

  completeSetup: (input: CompleteSetupInput): Promise<CompleteSetupResult> =>
    ipcRenderer.invoke(SETUP_COMPLETE_CHANNEL, input)
}

contextBridge.exposeInMainWorld('ledgerpage', api)

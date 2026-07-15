import type { LedgerPageApi } from '../../shared/ipc/appInfo'

declare global {
  interface Window {
    ledgerpage: LedgerPageApi
  }
}

export {}

import type { LedgerPageApi } from '../../shared/ipc/appInfo'
import type { LedgerPageSetupApi } from '../../shared/ipc/setup'

declare global {
  interface Window {
    ledgerpage: LedgerPageApi & LedgerPageSetupApi
  }
}

export {}

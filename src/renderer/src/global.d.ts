import type { LedgerPageApi } from '../../shared/ipc/appInfo'
import type { LedgerPageSetupApi } from '../../shared/ipc/setup'
import type { LedgerPageLoginApi } from '../../shared/ipc/login'
import type { LedgerPageUsersApi } from '../../shared/ipc/users'
import type { LedgerPageAuditApi } from '../../shared/ipc/audit'

declare global {
  interface Window {
    ledgerpage: LedgerPageApi &
      LedgerPageSetupApi &
      LedgerPageLoginApi &
      LedgerPageUsersApi &
      LedgerPageAuditApi
  }
}

export {}

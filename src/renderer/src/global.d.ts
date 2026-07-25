import type { LedgerPageApi } from '../../shared/ipc/appInfo'
import type { LedgerPageSetupApi } from '../../shared/ipc/setup'
import type { LedgerPageLoginApi } from '../../shared/ipc/login'
import type { LedgerPageUsersApi } from '../../shared/ipc/users'
import type { LedgerPageAuditApi } from '../../shared/ipc/audit'
import type { LedgerPageProductsApi } from '../../shared/ipc/products'
import type { LedgerPageInventoryItemsApi } from '../../shared/ipc/inventoryItems'
import type { LedgerPageSuppliersApi } from '../../shared/ipc/suppliers'

declare global {
  interface Window {
    ledgerpage: LedgerPageApi &
      LedgerPageSetupApi &
      LedgerPageLoginApi &
      LedgerPageUsersApi &
      LedgerPageAuditApi &
      LedgerPageProductsApi &
      LedgerPageInventoryItemsApi &
      LedgerPageSuppliersApi
  }
}

export {}

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
import {
  LOGIN_ATTEMPT_CHANNEL,
  LOGIN_GET_SESSION_STATE_CHANNEL,
  LOGIN_LOGOUT_CHANNEL,
  LOGIN_TOUCH_CHANNEL,
  LOGIN_UNLOCK_CHANNEL,
  type LedgerPageLoginApi,
  type LoginAttemptInput,
  type LoginResult,
  type SessionState,
  type UnlockInput,
  type UnlockResult
} from '../shared/ipc/login'
import {
  ROLES_LIST_ASSIGNABLE_CHANNEL,
  USERS_CREATE_CHANNEL,
  USERS_DEACTIVATE_CHANNEL,
  USERS_LIST_CHANNEL,
  USERS_REACTIVATE_CHANNEL,
  type CreateUserInput,
  type CreateUserResult,
  type LedgerPageUsersApi,
  type ListAssignableRolesResult,
  type ListUsersResult,
  type MutateUserResult,
  type UserIdInput
} from '../shared/ipc/users'
import {
  AUDIT_LIST_CHANNEL,
  type LedgerPageAuditApi,
  type ListAuditEntriesInput,
  type ListAuditEntriesResult
} from '../shared/ipc/audit'
import {
  PRODUCTS_CREATE_CHANNEL,
  PRODUCTS_DEACTIVATE_CHANNEL,
  PRODUCTS_GET_CHANNEL,
  PRODUCTS_LIST_ASSIGNABLE_TAX_CODES_CHANNEL,
  PRODUCTS_LIST_CHANNEL,
  PRODUCTS_REACTIVATE_CHANNEL,
  PRODUCTS_UPDATE_CHANNEL,
  PRODUCT_VARIANTS_CREATE_CHANNEL,
  PRODUCT_VARIANTS_DEACTIVATE_CHANNEL,
  PRODUCT_VARIANTS_GET_CHANNEL,
  PRODUCT_VARIANTS_LIST_FOR_PRODUCT_CHANNEL,
  PRODUCT_VARIANTS_REACTIVATE_CHANNEL,
  PRODUCT_VARIANTS_UPDATE_CHANNEL,
  type CreateProductInput,
  type CreateProductResult,
  type CreateVariantInput,
  type CreateVariantResult,
  type GetProductResult,
  type GetVariantResult,
  type LedgerPageProductsApi,
  type ListAssignableTaxCodesResult,
  type ListProductsResult,
  type ListVariantsForProductInput,
  type ListVariantsForProductResult,
  type MutateProductResult,
  type MutateVariantResult,
  type ProductIdInput,
  type UpdateProductInput,
  type UpdateProductResult,
  type UpdateVariantInput,
  type UpdateVariantResult,
  type VariantIdInput
} from '../shared/ipc/products'
import {
  INVENTORY_ITEMS_CREATE_CHANNEL,
  INVENTORY_ITEMS_DEACTIVATE_CHANNEL,
  INVENTORY_ITEMS_GET_CHANNEL,
  INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL,
  INVENTORY_ITEMS_LIST_CHANNEL,
  INVENTORY_ITEMS_REACTIVATE_CHANNEL,
  INVENTORY_ITEMS_UPDATE_CHANNEL,
  type CreateInventoryItemInput,
  type CreateInventoryItemResult,
  type GetInventoryItemResult,
  type InventoryItemIdInput,
  type LedgerPageInventoryItemsApi,
  type ListAssignableUnitsOfMeasureResult,
  type ListInventoryItemsResult,
  type MutateInventoryItemResult,
  type UpdateInventoryItemInput,
  type UpdateInventoryItemResult
} from '../shared/ipc/inventoryItems'
import {
  SUPPLIER_PRICES_GET_CURRENT_CHANNEL,
  SUPPLIER_PRICES_LIST_FOR_ITEM_CHANNEL,
  SUPPLIER_PRICES_LIST_FOR_SUPPLIER_CHANNEL,
  SUPPLIER_PRICES_RECORD_CHANNEL,
  SUPPLIERS_CREATE_CHANNEL,
  SUPPLIERS_DEACTIVATE_CHANNEL,
  SUPPLIERS_GET_CHANNEL,
  SUPPLIERS_LIST_CHANNEL,
  SUPPLIERS_REACTIVATE_CHANNEL,
  SUPPLIERS_UPDATE_CHANNEL,
  type CreateSupplierInput,
  type CreateSupplierResult,
  type GetCurrentSupplierItemPriceResult,
  type GetSupplierResult,
  type LedgerPageSuppliersApi,
  type ListSupplierItemPricesResult,
  type ListSuppliersResult,
  type MutateSupplierResult,
  type RecordSupplierPriceInput,
  type RecordSupplierPriceResult,
  type SupplierIdInput,
  type SupplierItemPairInput,
  type UpdateSupplierInput,
  type UpdateSupplierResult
} from '../shared/ipc/suppliers'
import {
  CUSTOMER_CONTACTS_CREATE_CHANNEL,
  CUSTOMER_CONTACTS_DEACTIVATE_CHANNEL,
  CUSTOMER_CONTACTS_GET_CHANNEL,
  CUSTOMER_CONTACTS_LIST_CHANNEL,
  CUSTOMER_CONTACTS_REACTIVATE_CHANNEL,
  CUSTOMER_CONTACTS_UPDATE_CHANNEL,
  CUSTOMERS_CREATE_CHANNEL,
  CUSTOMERS_DEACTIVATE_CHANNEL,
  CUSTOMERS_GET_CHANNEL,
  CUSTOMERS_LIST_CHANNEL,
  CUSTOMERS_REACTIVATE_CHANNEL,
  CUSTOMERS_UPDATE_CHANNEL,
  type CreateCustomerContactInput,
  type CreateCustomerContactResult,
  type CreateCustomerInput,
  type CreateCustomerResult,
  type CustomerContactIdInput,
  type CustomerIdInput,
  type GetCustomerContactResult,
  type GetCustomerResult,
  type LedgerPageCustomersApi,
  type ListCustomerContactsResult,
  type ListCustomersResult,
  type MutateCustomerContactResult,
  type MutateCustomerResult,
  type UpdateCustomerContactInput,
  type UpdateCustomerContactResult,
  type UpdateCustomerInput,
  type UpdateCustomerResult
} from '../shared/ipc/customers'
import {
  INVENTORY_LOTS_GET_CHANNEL,
  INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL,
  INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL,
  STOCK_GET_SUMMARY_CHANNEL,
  STOCK_LIST_SUMMARIES_CHANNEL,
  type GetInventoryLotResult,
  type GetStockSummaryResult,
  type InventoryLotIdInput,
  type LedgerPageInventoryLotsApi,
  type ListInventoryLotMovementsResult,
  type ListInventoryLotsForItemResult,
  type ListStockSummariesResult,
  type StockItemIdInput
} from '../shared/ipc/inventoryLots'
import {
  ACCOUNTS_CREATE_CHANNEL,
  ACCOUNTS_DEACTIVATE_CHANNEL,
  ACCOUNTS_GET_CHANNEL,
  ACCOUNTS_LIST_CHANNEL,
  ACCOUNTS_REACTIVATE_CHANNEL,
  ACCOUNTS_UPDATE_CHANNEL,
  JOURNAL_ENTRIES_CREATE_CHANNEL,
  JOURNAL_ENTRIES_GET_CHANNEL,
  JOURNAL_ENTRIES_LIST_CHANNEL,
  JOURNAL_ENTRIES_REVERSE_CHANNEL,
  TRIAL_BALANCE_GET_CHANNEL,
  type AccountIdInput,
  type CreateAccountRendererInput,
  type CreateJournalEntryRendererInput,
  type GetAccountResult,
  type GetJournalEntryResult,
  type GetTrialBalanceResult,
  type JournalEntryIdInput,
  type LedgerPageAccountingApi,
  type ListAccountsResult,
  type ListJournalEntriesResult,
  type MutateAccountResult,
  type MutateJournalEntryResult,
  type ReverseJournalEntryRendererInput,
  type UpdateAccountRendererInput
} from '../shared/ipc/accounting'

/**
 * The entire renderer-facing API for LedgerPage.
 *
 * getAppInfo: proves the contextBridge pattern works end to end, not
 * real application capability (Slice 2).
 *
 * The five setup:* methods are Slice 8's narrow, immutable first-run
 * surface.
 *
 * The five login:* methods and the users/roles methods are Slice 9's
 * narrow surface. No channel here accepts or returns a session id —
 * every login/session operation implicitly targets whatever the main
 * process considers "the current session"; the renderer never sees or
 * supplies one. Every users/roles mutation is re-authorized fresh,
 * server-side, from live SQLite role data on every call — this preload
 * layer carries no isOwner flag of its own and grants nothing by
 * itself.
 *
 * listAuditEntries is Slice 10's one, read-only method. Like every
 * users/roles call above, it is re-authorized fresh, server-side, on
 * every single call — this preload layer's session.canViewAuditLog
 * (used only to decide whether the renderer *shows* an Audit Log link)
 * carries no authority of its own and is never consulted by the actual
 * handler.
 *
 * Deliberately absent, on every one of these: a database handle,
 * arbitrary SQL, filesystem access, a password hash, a recovery hash,
 * a session id, unrestricted role mutation (no channel can grant or
 * remove the Owner role), a way to update or delete an audit entry, or
 * any way to invoke anything else in the main process. Do not add
 * additional keys here without updating the corresponding shared/ipc
 * source file and its tests.
 */
const api: LedgerPageApi &
  LedgerPageSetupApi &
  LedgerPageLoginApi &
  LedgerPageUsersApi &
  LedgerPageAuditApi &
  LedgerPageProductsApi &
  LedgerPageInventoryItemsApi &
  LedgerPageSuppliersApi &
  LedgerPageCustomersApi &
  LedgerPageInventoryLotsApi &
  LedgerPageAccountingApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNEL),

  getFirstRunStatus: (): Promise<FirstRunStatus> => ipcRenderer.invoke(SETUP_GET_STATUS_CHANNEL),

  prepareRecoveryKey: (): Promise<PrepareRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_PREPARE_RECOVERY_KEY_CHANNEL),

  confirmRecoveryKey: (input: ConfirmRecoveryKeyInput): Promise<ConfirmRecoveryKeyResult> =>
    ipcRenderer.invoke(SETUP_CONFIRM_RECOVERY_KEY_CHANNEL, input),

  cancelRecoveryKey: (input: CancelRecoveryKeyInput): Promise<void> =>
    ipcRenderer.invoke(SETUP_CANCEL_RECOVERY_KEY_CHANNEL, input),

  completeSetup: (input: CompleteSetupInput): Promise<CompleteSetupResult> =>
    ipcRenderer.invoke(SETUP_COMPLETE_CHANNEL, input),

  login: (input: LoginAttemptInput): Promise<LoginResult> =>
    ipcRenderer.invoke(LOGIN_ATTEMPT_CHANNEL, input),

  getSessionState: (): Promise<SessionState> => ipcRenderer.invoke(LOGIN_GET_SESSION_STATE_CHANNEL),

  unlockSession: (input: UnlockInput): Promise<UnlockResult> =>
    ipcRenderer.invoke(LOGIN_UNLOCK_CHANNEL, input),

  logout: (): Promise<void> => ipcRenderer.invoke(LOGIN_LOGOUT_CHANNEL),

  touchSession: (): Promise<void> => ipcRenderer.invoke(LOGIN_TOUCH_CHANNEL),

  listUsers: (): Promise<ListUsersResult> => ipcRenderer.invoke(USERS_LIST_CHANNEL),

  createUser: (input: CreateUserInput): Promise<CreateUserResult> =>
    ipcRenderer.invoke(USERS_CREATE_CHANNEL, input),

  deactivateUser: (input: UserIdInput): Promise<MutateUserResult> =>
    ipcRenderer.invoke(USERS_DEACTIVATE_CHANNEL, input),

  reactivateUser: (input: UserIdInput): Promise<MutateUserResult> =>
    ipcRenderer.invoke(USERS_REACTIVATE_CHANNEL, input),

  listAssignableRoles: (): Promise<ListAssignableRolesResult> =>
    ipcRenderer.invoke(ROLES_LIST_ASSIGNABLE_CHANNEL),

  listAuditEntries: (input: ListAuditEntriesInput): Promise<ListAuditEntriesResult> =>
    ipcRenderer.invoke(AUDIT_LIST_CHANNEL, input),

  listProducts: (): Promise<ListProductsResult> => ipcRenderer.invoke(PRODUCTS_LIST_CHANNEL),

  getProduct: (input: ProductIdInput): Promise<GetProductResult> =>
    ipcRenderer.invoke(PRODUCTS_GET_CHANNEL, input),

  createProduct: (input: CreateProductInput): Promise<CreateProductResult> =>
    ipcRenderer.invoke(PRODUCTS_CREATE_CHANNEL, input),

  updateProduct: (input: UpdateProductInput): Promise<UpdateProductResult> =>
    ipcRenderer.invoke(PRODUCTS_UPDATE_CHANNEL, input),

  deactivateProduct: (input: ProductIdInput): Promise<MutateProductResult> =>
    ipcRenderer.invoke(PRODUCTS_DEACTIVATE_CHANNEL, input),

  reactivateProduct: (input: ProductIdInput): Promise<MutateProductResult> =>
    ipcRenderer.invoke(PRODUCTS_REACTIVATE_CHANNEL, input),

  listVariantsForProduct: (
    input: ListVariantsForProductInput
  ): Promise<ListVariantsForProductResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_LIST_FOR_PRODUCT_CHANNEL, input),

  getVariant: (input: VariantIdInput): Promise<GetVariantResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_GET_CHANNEL, input),

  createVariant: (input: CreateVariantInput): Promise<CreateVariantResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_CREATE_CHANNEL, input),

  updateVariant: (input: UpdateVariantInput): Promise<UpdateVariantResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_UPDATE_CHANNEL, input),

  deactivateVariant: (input: VariantIdInput): Promise<MutateVariantResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_DEACTIVATE_CHANNEL, input),

  reactivateVariant: (input: VariantIdInput): Promise<MutateVariantResult> =>
    ipcRenderer.invoke(PRODUCT_VARIANTS_REACTIVATE_CHANNEL, input),

  listAssignableTaxCodes: (): Promise<ListAssignableTaxCodesResult> =>
    ipcRenderer.invoke(PRODUCTS_LIST_ASSIGNABLE_TAX_CODES_CHANNEL),

  listInventoryItems: (): Promise<ListInventoryItemsResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_LIST_CHANNEL),

  getInventoryItem: (input: InventoryItemIdInput): Promise<GetInventoryItemResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_GET_CHANNEL, input),

  createInventoryItem: (input: CreateInventoryItemInput): Promise<CreateInventoryItemResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_CREATE_CHANNEL, input),

  updateInventoryItem: (input: UpdateInventoryItemInput): Promise<UpdateInventoryItemResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_UPDATE_CHANNEL, input),

  deactivateInventoryItem: (input: InventoryItemIdInput): Promise<MutateInventoryItemResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_DEACTIVATE_CHANNEL, input),

  reactivateInventoryItem: (input: InventoryItemIdInput): Promise<MutateInventoryItemResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_REACTIVATE_CHANNEL, input),

  listAssignableUnitsOfMeasure: (): Promise<ListAssignableUnitsOfMeasureResult> =>
    ipcRenderer.invoke(INVENTORY_ITEMS_LIST_ASSIGNABLE_UNITS_CHANNEL),

  listSuppliers: (): Promise<ListSuppliersResult> => ipcRenderer.invoke(SUPPLIERS_LIST_CHANNEL),

  getSupplier: (input: SupplierIdInput): Promise<GetSupplierResult> =>
    ipcRenderer.invoke(SUPPLIERS_GET_CHANNEL, input),

  createSupplier: (input: CreateSupplierInput): Promise<CreateSupplierResult> =>
    ipcRenderer.invoke(SUPPLIERS_CREATE_CHANNEL, input),

  updateSupplier: (input: UpdateSupplierInput): Promise<UpdateSupplierResult> =>
    ipcRenderer.invoke(SUPPLIERS_UPDATE_CHANNEL, input),

  deactivateSupplier: (input: SupplierIdInput): Promise<MutateSupplierResult> =>
    ipcRenderer.invoke(SUPPLIERS_DEACTIVATE_CHANNEL, input),

  reactivateSupplier: (input: SupplierIdInput): Promise<MutateSupplierResult> =>
    ipcRenderer.invoke(SUPPLIERS_REACTIVATE_CHANNEL, input),

  recordSupplierPrice: (input: RecordSupplierPriceInput): Promise<RecordSupplierPriceResult> =>
    ipcRenderer.invoke(SUPPLIER_PRICES_RECORD_CHANNEL, input),

  listPricesForSupplier: (input: SupplierIdInput): Promise<ListSupplierItemPricesResult> =>
    ipcRenderer.invoke(SUPPLIER_PRICES_LIST_FOR_SUPPLIER_CHANNEL, input),

  listPricesForInventoryItem: (
    input: Pick<SupplierItemPairInput, 'inventoryItemId'>
  ): Promise<ListSupplierItemPricesResult> =>
    ipcRenderer.invoke(SUPPLIER_PRICES_LIST_FOR_ITEM_CHANNEL, input),

  getCurrentSupplierItemPrice: (
    input: SupplierItemPairInput
  ): Promise<GetCurrentSupplierItemPriceResult> =>
    ipcRenderer.invoke(SUPPLIER_PRICES_GET_CURRENT_CHANNEL, input),

  listCustomers: (): Promise<ListCustomersResult> => ipcRenderer.invoke(CUSTOMERS_LIST_CHANNEL),

  getCustomer: (input: CustomerIdInput): Promise<GetCustomerResult> =>
    ipcRenderer.invoke(CUSTOMERS_GET_CHANNEL, input),

  createCustomer: (input: CreateCustomerInput): Promise<CreateCustomerResult> =>
    ipcRenderer.invoke(CUSTOMERS_CREATE_CHANNEL, input),

  updateCustomer: (input: UpdateCustomerInput): Promise<UpdateCustomerResult> =>
    ipcRenderer.invoke(CUSTOMERS_UPDATE_CHANNEL, input),

  deactivateCustomer: (input: CustomerIdInput): Promise<MutateCustomerResult> =>
    ipcRenderer.invoke(CUSTOMERS_DEACTIVATE_CHANNEL, input),

  reactivateCustomer: (input: CustomerIdInput): Promise<MutateCustomerResult> =>
    ipcRenderer.invoke(CUSTOMERS_REACTIVATE_CHANNEL, input),

  listContactsForCustomer: (input: CustomerIdInput): Promise<ListCustomerContactsResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_LIST_CHANNEL, input),

  getCustomerContact: (input: CustomerContactIdInput): Promise<GetCustomerContactResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_GET_CHANNEL, input),

  createCustomerContact: (
    input: CreateCustomerContactInput
  ): Promise<CreateCustomerContactResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_CREATE_CHANNEL, input),

  updateCustomerContact: (
    input: UpdateCustomerContactInput
  ): Promise<UpdateCustomerContactResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_UPDATE_CHANNEL, input),

  deactivateCustomerContact: (
    input: CustomerContactIdInput
  ): Promise<MutateCustomerContactResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_DEACTIVATE_CHANNEL, input),

  reactivateCustomerContact: (
    input: CustomerContactIdInput
  ): Promise<MutateCustomerContactResult> =>
    ipcRenderer.invoke(CUSTOMER_CONTACTS_REACTIVATE_CHANNEL, input),

  listInventoryLotsForItem: (input: StockItemIdInput): Promise<ListInventoryLotsForItemResult> =>
    ipcRenderer.invoke(INVENTORY_LOTS_LIST_FOR_ITEM_CHANNEL, input),

  getInventoryLot: (input: InventoryLotIdInput): Promise<GetInventoryLotResult> =>
    ipcRenderer.invoke(INVENTORY_LOTS_GET_CHANNEL, input),

  listInventoryLotMovements: (
    input: InventoryLotIdInput
  ): Promise<ListInventoryLotMovementsResult> =>
    ipcRenderer.invoke(INVENTORY_LOTS_LIST_MOVEMENTS_CHANNEL, input),

  listStockSummaries: (): Promise<ListStockSummariesResult> =>
    ipcRenderer.invoke(STOCK_LIST_SUMMARIES_CHANNEL),

  getStockSummary: (input: StockItemIdInput): Promise<GetStockSummaryResult> =>
    ipcRenderer.invoke(STOCK_GET_SUMMARY_CHANNEL, input),

  listAccounts: (): Promise<ListAccountsResult> => ipcRenderer.invoke(ACCOUNTS_LIST_CHANNEL),

  getAccount: (input: AccountIdInput): Promise<GetAccountResult> =>
    ipcRenderer.invoke(ACCOUNTS_GET_CHANNEL, input),

  createAccount: (input: CreateAccountRendererInput): Promise<MutateAccountResult> =>
    ipcRenderer.invoke(ACCOUNTS_CREATE_CHANNEL, input),

  updateAccount: (input: UpdateAccountRendererInput): Promise<MutateAccountResult> =>
    ipcRenderer.invoke(ACCOUNTS_UPDATE_CHANNEL, input),

  deactivateAccount: (input: AccountIdInput): Promise<MutateAccountResult> =>
    ipcRenderer.invoke(ACCOUNTS_DEACTIVATE_CHANNEL, input),

  reactivateAccount: (input: AccountIdInput): Promise<MutateAccountResult> =>
    ipcRenderer.invoke(ACCOUNTS_REACTIVATE_CHANNEL, input),

  listJournalEntries: (): Promise<ListJournalEntriesResult> =>
    ipcRenderer.invoke(JOURNAL_ENTRIES_LIST_CHANNEL),

  getJournalEntry: (input: JournalEntryIdInput): Promise<GetJournalEntryResult> =>
    ipcRenderer.invoke(JOURNAL_ENTRIES_GET_CHANNEL, input),

  createJournalEntry: (input: CreateJournalEntryRendererInput): Promise<MutateJournalEntryResult> =>
    ipcRenderer.invoke(JOURNAL_ENTRIES_CREATE_CHANNEL, input),

  reverseJournalEntry: (
    input: ReverseJournalEntryRendererInput
  ): Promise<MutateJournalEntryResult> =>
    ipcRenderer.invoke(JOURNAL_ENTRIES_REVERSE_CHANNEL, input),

  getTrialBalance: (): Promise<GetTrialBalanceResult> =>
    ipcRenderer.invoke(TRIAL_BALANCE_GET_CHANNEL)
}

contextBridge.exposeInMainWorld('ledgerpage', api)

import { useState } from 'react'
import { UsersAndRolesScreen } from '../users/UsersAndRolesScreen'
import { AuditLogScreen } from '../audit/AuditLogScreen'
import { ProductListScreen } from '../products/ProductListScreen'
import { ProductDetailScreen } from '../products/ProductDetailScreen'
import { InventoryItemListScreen } from '../inventoryItems/InventoryItemListScreen'
import { InventoryItemDetailScreen } from '../inventoryItems/InventoryItemDetailScreen'
import { SupplierListScreen } from '../suppliers/SupplierListScreen'
import { SupplierDetailScreen } from '../suppliers/SupplierDetailScreen'
import { CustomerListScreen } from '../customers/CustomerListScreen'
import { CustomerDetailScreen } from '../customers/CustomerDetailScreen'
import { StockOnHandScreen } from '../inventory/StockOnHandScreen'
import { InventoryItemLotsScreen } from '../inventory/InventoryItemLotsScreen'
import { InventoryLotDetailScreen } from '../inventory/InventoryLotDetailScreen'
import { ChartOfAccountsScreen } from '../accounting/ChartOfAccountsScreen'
import { JournalEntriesScreen } from '../accounting/JournalEntriesScreen'
import { ManualJournalEntryScreen } from '../accounting/ManualJournalEntryScreen'
import { JournalEntryDetailScreen } from '../accounting/JournalEntryDetailScreen'
import { TrialBalanceScreen } from '../accounting/TrialBalanceScreen'
import { colors, fonts } from '../setup/ui'
import type { SafeSessionInfo } from '../../../shared/ipc/login'

interface AuthenticatedShellProps {
  session: SafeSessionInfo
  onLoggedOut: () => void
}

type View =
  | 'home'
  | 'users'
  | 'audit'
  | 'products'
  | 'inventory-items'
  | 'suppliers'
  | 'customers'
  | 'stock'
  | 'accounting'

/**
 * Local navigation within the Products area only — list/create/detail —
 * kept entirely inside this shell, not a separate routing library, per
 * the approved decision. Independent of `view` itself: switching away
 * to another top-level view and back to 'products' resets this to
 * 'list' (see the Products nav button's own onClick below), matching
 * "returning to the list reloads authoritative data" — ProductListScreen
 * fetches fresh on every mount, and switching productsRoute to a
 * different screen kind always actually unmounts/remounts the
 * component (a different component is rendered), so this is satisfied
 * by construction, not a separate reload call.
 */
type ProductsRoute =
  { screen: 'list' } | { screen: 'create' } | { screen: 'detail'; productId: string }

/**
 * Same local-routing posture as ProductsRoute above, applied to the
 * Inventory Items area — list/create/detail, no routing library,
 * reset to 'list' whenever the nav link itself is clicked.
 */
type InventoryItemsRoute =
  { screen: 'list' } | { screen: 'create' } | { screen: 'detail'; inventoryItemId: string }

/**
 * Same local-routing posture as ProductsRoute/InventoryItemsRoute above
 * — list/create/detail, no routing library, reset to 'list' whenever
 * the nav link itself is clicked.
 */
type SuppliersRoute =
  { screen: 'list' } | { screen: 'create' } | { screen: 'detail'; supplierId: string }

/**
 * Same local-routing posture as ProductsRoute/InventoryItemsRoute/
 * SuppliersRoute above — list/create/detail, no routing library, reset
 * to 'list' whenever the nav link itself is clicked.
 */
type CustomersRoute =
  { screen: 'list' } | { screen: 'create' } | { screen: 'detail'; customerId: string }

/**
 * Same local-routing posture as the other routes above, but with no
 * 'create' screen at all — this slice's own approved architecture is
 * entirely read-only, so there is no create/edit route for stock.
 */
type StockRoute =
  | { screen: 'list' }
  | { screen: 'item-lots'; inventoryItemId: string; itemCode: string; itemName: string }
  | { screen: 'lot-detail'; lotId: string }

/**
 * Local navigation within the Accounting area only — kept entirely
 * inside this shell, no routing library, mirroring StockRoute's own
 * exact precedent. The Accounting nav itself lands on 'accounts'
 * (Chart of Accounts) as the default landing page; 'journals' is
 * reached via its own nav button.
 */
type AccountingRoute =
  | { screen: 'accounts' }
  | { screen: 'journals' }
  | { screen: 'journal-create' }
  | { screen: 'journal-detail'; journalEntryId: string }
  | { screen: 'trial-balance' }

/**
 * The authenticated application area. The "Users & Roles" link is
 * rendered only when `session.isOwner` is true, and the "Audit Log"
 * link only when `session.canViewAuditLog` is true — both purely
 * cosmetic conveniences, not security boundaries: the actual
 * enforcement lives entirely in the main process (userManagementService
 * and requireAuthorizedCaller's own fresh, SQLite-sourced authorization
 * checks on every call), exactly per the acceptance criterion that an
 * unauthorized caller must be blocked there regardless of what this
 * renderer shows or hides.
 */
export function AuthenticatedShell({ session, onLoggedOut }: AuthenticatedShellProps) {
  const [view, setView] = useState<View>('home')
  const [productsRoute, setProductsRoute] = useState<ProductsRoute>({ screen: 'list' })
  const [inventoryItemsRoute, setInventoryItemsRoute] = useState<InventoryItemsRoute>({
    screen: 'list'
  })
  const [suppliersRoute, setSuppliersRoute] = useState<SuppliersRoute>({ screen: 'list' })
  const [customersRoute, setCustomersRoute] = useState<CustomersRoute>({ screen: 'list' })
  const [stockRoute, setStockRoute] = useState<StockRoute>({ screen: 'list' })
  /**
   * Tracks which item-lots screen a lot-detail view was opened from,
   * so Back from lot detail returns to that same item's lot list
   * (preserving the selected item context) rather than jumping all
   * the way back to the top-level Stock list. The lot-detail route
   * itself only carries a lotId, not the originating item, so this is
   * tracked separately -- a small, local breadcrumb, not a routing
   * library.
   */
  const [lastItemLotsContext, setLastItemLotsContext] = useState<
    { inventoryItemId: string; itemCode: string; itemName: string } | undefined
  >(undefined)
  const [accountingRoute, setAccountingRoute] = useState<AccountingRoute>({ screen: 'accounts' })

  async function handleLogout(): Promise<void> {
    try {
      await window.ledgerpage.logout()
    } finally {
      onLoggedOut()
    }
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafafa' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.75rem 1.5rem',
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`
        }}
      >
        <button
          type="button"
          onClick={() => setView('home')}
          style={{
            fontFamily: fonts.display,
            fontSize: '1.0625rem',
            fontWeight: 600,
            color: colors.ink,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 0
          }}
        >
          LedgerPage
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <span style={{ fontSize: '0.875rem', color: colors.mutedInk }}>
            {session.displayName}
          </span>
          {session.isOwner && (
            <button
              type="button"
              onClick={() => setView('users')}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'users' ? 700 : 500
              }}
            >
              Users &amp; Roles
            </button>
          )}
          {session.canViewAuditLog && (
            <button
              type="button"
              onClick={() => setView('audit')}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'audit' ? 700 : 500
              }}
            >
              Audit Log
            </button>
          )}
          {session.canViewProducts && (
            <button
              type="button"
              onClick={() => {
                setView('products')
                setProductsRoute({ screen: 'list' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'products' ? 700 : 500
              }}
            >
              Products
            </button>
          )}
          {session.canViewInventoryItems && (
            <button
              type="button"
              onClick={() => {
                setView('inventory-items')
                setInventoryItemsRoute({ screen: 'list' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'inventory-items' ? 700 : 500
              }}
            >
              Inventory Items
            </button>
          )}
          {session.canViewSuppliers && (
            <button
              type="button"
              onClick={() => {
                setView('suppliers')
                setSuppliersRoute({ screen: 'list' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'suppliers' ? 700 : 500
              }}
            >
              Suppliers
            </button>
          )}
          {session.canViewCustomers && (
            <button
              type="button"
              onClick={() => {
                setView('customers')
                setCustomersRoute({ screen: 'list' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'customers' ? 700 : 500
              }}
            >
              Customers
            </button>
          )}
          {session.canViewInventoryLots && (
            <button
              type="button"
              onClick={() => {
                setView('stock')
                setStockRoute({ screen: 'list' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'stock' ? 700 : 500
              }}
            >
              Stock
            </button>
          )}
          {session.canViewAccounts && (
            <button
              type="button"
              onClick={() => {
                setView('accounting')
                setAccountingRoute({ screen: 'accounts' })
              }}
              style={{
                fontSize: '0.875rem',
                color: colors.accent,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                fontWeight: view === 'accounting' ? 700 : 500
              }}
            >
              Accounting
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleLogout()}
            style={{
              fontSize: '0.875rem',
              color: colors.mutedInk,
              background: 'none',
              border: `1px solid ${colors.border}`,
              borderRadius: '0.375rem',
              padding: '0.375rem 0.75rem',
              cursor: 'pointer'
            }}
          >
            Log out
          </button>
        </div>
      </header>

      {view === 'users' && <UsersAndRolesScreen />}
      {view === 'audit' && <AuditLogScreen />}
      {view === 'products' && productsRoute.screen === 'list' && (
        <ProductListScreen
          canManageProducts={session.canManageProducts}
          onOpenProduct={(productId) => setProductsRoute({ screen: 'detail', productId })}
          onCreateProduct={() => setProductsRoute({ screen: 'create' })}
        />
      )}
      {view === 'products' && productsRoute.screen === 'create' && (
        <ProductDetailScreen
          canManageProducts={session.canManageProducts}
          onBack={() => setProductsRoute({ screen: 'list' })}
          onSaved={(productId) => setProductsRoute({ screen: 'detail', productId })}
        />
      )}
      {view === 'products' && productsRoute.screen === 'detail' && (
        <ProductDetailScreen
          productId={productsRoute.productId}
          canManageProducts={session.canManageProducts}
          onBack={() => setProductsRoute({ screen: 'list' })}
          onSaved={(productId) => setProductsRoute({ screen: 'detail', productId })}
        />
      )}
      {view === 'inventory-items' && inventoryItemsRoute.screen === 'list' && (
        <InventoryItemListScreen
          canManageInventoryItems={session.canManageInventoryItems}
          onOpenInventoryItem={(inventoryItemId) =>
            setInventoryItemsRoute({ screen: 'detail', inventoryItemId })
          }
          onCreateInventoryItem={() => setInventoryItemsRoute({ screen: 'create' })}
        />
      )}
      {view === 'inventory-items' && inventoryItemsRoute.screen === 'create' && (
        <InventoryItemDetailScreen
          canManageInventoryItems={session.canManageInventoryItems}
          onBack={() => setInventoryItemsRoute({ screen: 'list' })}
          onSaved={(inventoryItemId) =>
            setInventoryItemsRoute({ screen: 'detail', inventoryItemId })
          }
        />
      )}
      {view === 'inventory-items' && inventoryItemsRoute.screen === 'detail' && (
        <InventoryItemDetailScreen
          inventoryItemId={inventoryItemsRoute.inventoryItemId}
          canManageInventoryItems={session.canManageInventoryItems}
          onBack={() => setInventoryItemsRoute({ screen: 'list' })}
          onSaved={(inventoryItemId) =>
            setInventoryItemsRoute({ screen: 'detail', inventoryItemId })
          }
        />
      )}
      {view === 'suppliers' && suppliersRoute.screen === 'list' && (
        <SupplierListScreen
          canManageSuppliers={session.canManageSuppliers}
          onOpenSupplier={(supplierId) => setSuppliersRoute({ screen: 'detail', supplierId })}
          onCreateSupplier={() => setSuppliersRoute({ screen: 'create' })}
        />
      )}
      {view === 'suppliers' && suppliersRoute.screen === 'create' && (
        <SupplierDetailScreen
          canManageSuppliers={session.canManageSuppliers}
          onBack={() => setSuppliersRoute({ screen: 'list' })}
          onSaved={(supplierId) => setSuppliersRoute({ screen: 'detail', supplierId })}
        />
      )}
      {view === 'suppliers' && suppliersRoute.screen === 'detail' && (
        <SupplierDetailScreen
          supplierId={suppliersRoute.supplierId}
          canManageSuppliers={session.canManageSuppliers}
          onBack={() => setSuppliersRoute({ screen: 'list' })}
          onSaved={(supplierId) => setSuppliersRoute({ screen: 'detail', supplierId })}
        />
      )}
      {view === 'customers' && customersRoute.screen === 'list' && (
        <CustomerListScreen
          canManageCustomers={session.canManageCustomers}
          onOpenCustomer={(customerId) => setCustomersRoute({ screen: 'detail', customerId })}
          onCreateCustomer={() => setCustomersRoute({ screen: 'create' })}
        />
      )}
      {view === 'customers' && customersRoute.screen === 'create' && (
        <CustomerDetailScreen
          canManageCustomers={session.canManageCustomers}
          onBack={() => setCustomersRoute({ screen: 'list' })}
          onSaved={(customerId) => setCustomersRoute({ screen: 'detail', customerId })}
        />
      )}
      {view === 'customers' && customersRoute.screen === 'detail' && (
        <CustomerDetailScreen
          customerId={customersRoute.customerId}
          canManageCustomers={session.canManageCustomers}
          onBack={() => setCustomersRoute({ screen: 'list' })}
          onSaved={(customerId) => setCustomersRoute({ screen: 'detail', customerId })}
        />
      )}
      {view === 'stock' && stockRoute.screen === 'list' && (
        <StockOnHandScreen
          onOpenItemLots={(inventoryItemId, itemCode, itemName) =>
            setStockRoute({ screen: 'item-lots', inventoryItemId, itemCode, itemName })
          }
        />
      )}
      {view === 'stock' && stockRoute.screen === 'item-lots' && (
        <InventoryItemLotsScreen
          inventoryItemId={stockRoute.inventoryItemId}
          itemCode={stockRoute.itemCode}
          itemName={stockRoute.itemName}
          onBack={() => setStockRoute({ screen: 'list' })}
          onOpenLot={(lotId) => {
            setLastItemLotsContext({
              inventoryItemId: stockRoute.inventoryItemId,
              itemCode: stockRoute.itemCode,
              itemName: stockRoute.itemName
            })
            setStockRoute({ screen: 'lot-detail', lotId })
          }}
        />
      )}
      {view === 'stock' && stockRoute.screen === 'lot-detail' && (
        <InventoryLotDetailScreen
          lotId={stockRoute.lotId}
          onBack={() =>
            setStockRoute(
              lastItemLotsContext
                ? { screen: 'item-lots', ...lastItemLotsContext }
                : { screen: 'list' }
            )
          }
        />
      )}
      {view === 'accounting' && (
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <button
            type="button"
            onClick={() => setAccountingRoute({ screen: 'accounts' })}
            style={{
              fontSize: '0.8125rem',
              color: colors.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontWeight: accountingRoute.screen === 'accounts' ? 700 : 500
            }}
          >
            Chart of Accounts
          </button>
          <button
            type="button"
            onClick={() => setAccountingRoute({ screen: 'journals' })}
            style={{
              fontSize: '0.8125rem',
              color: colors.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontWeight:
                accountingRoute.screen === 'journals' ||
                accountingRoute.screen === 'journal-create' ||
                accountingRoute.screen === 'journal-detail'
                  ? 700
                  : 500
            }}
          >
            Journal Entries
          </button>
          <button
            type="button"
            onClick={() => setAccountingRoute({ screen: 'trial-balance' })}
            style={{
              fontSize: '0.8125rem',
              color: colors.accent,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              fontWeight: accountingRoute.screen === 'trial-balance' ? 700 : 500
            }}
          >
            Trial Balance
          </button>
        </div>
      )}
      {view === 'accounting' && accountingRoute.screen === 'accounts' && (
        <ChartOfAccountsScreen canManageAccounts={session.canManageAccounts} />
      )}
      {view === 'accounting' && accountingRoute.screen === 'journals' && (
        <JournalEntriesScreen
          canManageJournalEntries={session.canManageJournalEntries}
          onOpenJournalEntry={(journalEntryId) =>
            setAccountingRoute({ screen: 'journal-detail', journalEntryId })
          }
          onCreateJournalEntry={() => setAccountingRoute({ screen: 'journal-create' })}
        />
      )}
      {view === 'accounting' && accountingRoute.screen === 'journal-create' && (
        <ManualJournalEntryScreen
          onCreated={(journalEntryId) =>
            setAccountingRoute({ screen: 'journal-detail', journalEntryId })
          }
          onCancel={() => setAccountingRoute({ screen: 'journals' })}
        />
      )}
      {view === 'accounting' && accountingRoute.screen === 'journal-detail' && (
        <JournalEntryDetailScreen
          journalEntryId={accountingRoute.journalEntryId}
          canManageJournalEntries={session.canManageJournalEntries}
          onReversed={(reversalEntryId) =>
            setAccountingRoute({ screen: 'journal-detail', journalEntryId: reversalEntryId })
          }
          onBack={() => setAccountingRoute({ screen: 'journals' })}
        />
      )}
      {view === 'accounting' && accountingRoute.screen === 'trial-balance' && (
        <TrialBalanceScreen />
      )}
      {view === 'home' && (
        <main
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 1.5rem',
            fontFamily: 'system-ui, sans-serif',
            color: '#1a1a1a'
          }}
        >
          <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>LedgerPage</h1>
          <p style={{ color: '#666', marginTop: '0.5rem' }}>Slice 1 — application shell</p>
        </main>
      )}
    </div>
  )
}

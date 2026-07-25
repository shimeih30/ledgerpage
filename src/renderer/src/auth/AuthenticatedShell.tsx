import { useState } from 'react'
import { UsersAndRolesScreen } from '../users/UsersAndRolesScreen'
import { AuditLogScreen } from '../audit/AuditLogScreen'
import { ProductListScreen } from '../products/ProductListScreen'
import { ProductDetailScreen } from '../products/ProductDetailScreen'
import { InventoryItemListScreen } from '../inventoryItems/InventoryItemListScreen'
import { InventoryItemDetailScreen } from '../inventoryItems/InventoryItemDetailScreen'
import { SupplierListScreen } from '../suppliers/SupplierListScreen'
import { SupplierDetailScreen } from '../suppliers/SupplierDetailScreen'
import { colors, fonts } from '../setup/ui'
import type { SafeSessionInfo } from '../../../shared/ipc/login'

interface AuthenticatedShellProps {
  session: SafeSessionInfo
  onLoggedOut: () => void
}

type View = 'home' | 'users' | 'audit' | 'products' | 'inventory-items' | 'suppliers'

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

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthenticatedShell } from '../../src/renderer/src/auth/AuthenticatedShell'
import type { SafeSessionInfo } from '../../src/shared/ipc/login'

afterEach(() => {
  cleanup()
})

function installMockApi(): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState: vi.fn(),
    unlockSession: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn(),
    listAuditEntries: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    listProducts: vi.fn(),
    getProduct: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: vi.fn(),
    reactivateProduct: vi.fn(),
    listVariantsForProduct: vi.fn(),
    getVariant: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    deactivateVariant: vi.fn(),
    reactivateVariant: vi.fn(),
    listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] }),
    listInventoryItems: vi.fn().mockResolvedValue({ success: true, inventoryItems: [] }),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: vi.fn(),
    reactivateInventoryItem: vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn().mockResolvedValue({ success: true, units: [] }),
    listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [] }),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: vi.fn(),
    reactivateSupplier: vi.fn(),
    recordSupplierPrice: vi.fn(),
    listPricesForSupplier: vi.fn().mockResolvedValue({ success: true, prices: [] }),
    listPricesForInventoryItem: vi.fn().mockResolvedValue({ success: true, prices: [] }),
    getCurrentSupplierItemPrice: vi.fn().mockResolvedValue({ success: true, price: null }),
    listCustomers: vi.fn().mockResolvedValue({ success: true, customers: [] }),
    getCustomer: vi.fn(),
    createCustomer: vi.fn(),
    updateCustomer: vi.fn(),
    deactivateCustomer: vi.fn(),
    reactivateCustomer: vi.fn(),
    listContactsForCustomer: vi.fn().mockResolvedValue({ success: true, contacts: [] }),
    getCustomerContact: vi.fn(),
    createCustomerContact: vi.fn(),
    updateCustomerContact: vi.fn(),
    deactivateCustomerContact: vi.fn(),
    reactivateCustomerContact: vi.fn(),
    listInventoryLotsForItem: vi.fn().mockResolvedValue({ success: true, lots: [] }),
    getInventoryLot: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listInventoryLotMovements: vi.fn().mockResolvedValue({ success: true, movements: [] }),
    listStockSummaries: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
    getStockSummary: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    listAccounts: vi.fn().mockResolvedValue({ success: true, accounts: [] }),
    getAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    updateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    deactivateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reactivateAccount: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    listJournalEntries: vi.fn().mockResolvedValue({ success: true, entries: [] }),
    getJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' }),
    createJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    reverseJournalEntry: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_authorized' }),
    getTrialBalance: vi.fn().mockResolvedValue({
      success: true,
      trialBalance: {
        accounts: [],
        grandTotalDebitMinor: 0,
        grandTotalCreditMinor: 0,
        isBalanced: true
      }
    })
  }
}

function session(overrides: Partial<SafeSessionInfo>): SafeSessionInfo {
  return {
    displayName: 'Ben',
    isOwner: false,
    canViewAuditLog: false,
    canViewProducts: false,
    canManageProducts: false,
    canViewInventoryItems: false,
    canManageInventoryItems: false,
    canViewSuppliers: false,
    canManageSuppliers: false,
    canViewCustomers: false,
    canManageCustomers: false,
    canViewInventoryLots: false,
    canManageInventoryLots: false,
    canOverrideInventoryLots: false,
    canViewAccounts: false,
    canManageAccounts: false,
    canViewJournalEntries: false,
    canManageJournalEntries: false,
    ...overrides
  }
}

describe('AuthenticatedShell navigation', () => {
  it('shows the Audit Log link for an Owner (canViewAuditLog: true)', () => {
    installMockApi()
    render(
      <AuthenticatedShell
        session={session({ isOwner: true, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeDefined()
  })

  it('shows the Audit Log link for an Executive (isOwner: false, canViewAuditLog: true)', () => {
    installMockApi()
    render(
      <AuthenticatedShell
        session={session({ isOwner: false, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeDefined()
  })

  it('shows the Audit Log link for a Finance user (isOwner: false, canViewAuditLog: true)', () => {
    installMockApi()
    render(
      <AuthenticatedShell
        session={session({ isOwner: false, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeDefined()
  })

  it('hides the Audit Log link for an Operations user (canViewAuditLog: false)', () => {
    installMockApi()
    render(
      <AuthenticatedShell
        session={session({ isOwner: false, canViewAuditLog: false })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Audit Log' })).toBeNull()
  })

  it('the Users & Roles link remains governed by isOwner independently of canViewAuditLog', () => {
    installMockApi()
    // Owner: isOwner true, canViewAuditLog true — both links present.
    render(
      <AuthenticatedShell
        session={session({ isOwner: true, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Users & Roles' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeDefined()
  })

  it('a Finance user (canViewAuditLog true, isOwner false) sees Audit Log but not Users & Roles', () => {
    installMockApi()
    render(
      <AuthenticatedShell
        session={session({ isOwner: false, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Audit Log' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Users & Roles' })).toBeNull()
  })

  it('clicking Audit Log navigates to the AuditLogScreen', async () => {
    installMockApi()
    const user = userEvent.setup()
    render(
      <AuthenticatedShell
        session={session({ isOwner: true, canViewAuditLog: true })}
        onLoggedOut={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Audit Log' }))
    expect(await screen.findByText('Audit Log', { selector: 'h1' })).toBeDefined()
  })

  describe('Products navigation', () => {
    it('shows the Products link only when canViewProducts is true', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewProducts: true })} onLoggedOut={vi.fn()} />
      )
      expect(screen.getByRole('button', { name: 'Products' })).toBeDefined()
    })

    it('hides the Products link when canViewProducts is false', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewProducts: false })} onLoggedOut={vi.fn()} />
      )
      expect(screen.queryByRole('button', { name: 'Products' })).toBeNull()
    })

    it('clicking Products navigates to the product list', async () => {
      installMockApi()
      window.ledgerpage.listProducts = vi.fn().mockResolvedValue({ success: true, products: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell session={session({ canViewProducts: true })} onLoggedOut={vi.fn()} />
      )
      await user.click(screen.getByRole('button', { name: 'Products' }))
      expect(await screen.findByText('No products yet.')).toBeDefined()
    })

    it('New product opens create mode (name/type form, no code field)', async () => {
      installMockApi()
      window.ledgerpage.listProducts = vi.fn().mockResolvedValue({ success: true, products: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewProducts: true, canManageProducts: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Products' }))
      await user.click(await screen.findByRole('button', { name: 'New product' }))
      expect(await screen.findByRole('button', { name: 'Create product' })).toBeDefined()
    })

    it('selecting a row opens detail mode for that product', async () => {
      installMockApi()
      window.ledgerpage.listProducts = vi.fn().mockResolvedValue({
        success: true,
        products: [
          {
            id: 'product_1',
            code: 'PRD-000001',
            name: 'Jam',
            type: 'manufactured',
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      })
      window.ledgerpage.getProduct = vi.fn().mockResolvedValue({
        success: true,
        product: {
          id: 'product_1',
          code: 'PRD-000001',
          name: 'Jam',
          type: 'manufactured',
          isActive: true,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      })
      window.ledgerpage.listVariantsForProduct = vi
        .fn()
        .mockResolvedValue({ success: true, variants: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewProducts: true, canManageProducts: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Products' }))
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('PRD-000001')).toBeDefined()
    })

    it('successful creation opens the generated product detail, then Back returns to the list', async () => {
      installMockApi()
      window.ledgerpage.listProducts = vi.fn().mockResolvedValue({ success: true, products: [] })
      const createdProduct = {
        id: 'product_new',
        code: 'PRD-000042',
        name: 'Jam',
        type: 'manufactured' as const,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.createProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: createdProduct })
      // After onSaved, productId changes from undefined to a real value
      // on the same ProductDetailScreen instance -- React re-runs the
      // mount effect for the new productId, which re-fetches via
      // getProduct/listVariantsForProduct rather than reusing the
      // just-created product already held in local state.
      window.ledgerpage.getProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: createdProduct })
      window.ledgerpage.listVariantsForProduct = vi
        .fn()
        .mockResolvedValue({ success: true, variants: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewProducts: true, canManageProducts: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Products' }))
      await user.click(await screen.findByRole('button', { name: 'New product' }))
      await user.type(screen.getByLabelText('Name'), 'Jam')
      await user.click(screen.getByRole('button', { name: 'Create product' }))

      expect(await screen.findByText('PRD-000042')).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('No products yet.')).toBeDefined()
    })

    it('a Finance user (canViewProducts true, canManageProducts false) can navigate and inspect but sees no mutation controls', async () => {
      installMockApi()
      window.ledgerpage.listProducts = vi.fn().mockResolvedValue({
        success: true,
        products: [
          {
            id: 'product_1',
            code: 'PRD-000001',
            name: 'Jam',
            type: 'manufactured',
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewProducts: true, canManageProducts: false })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Products' }))
      await screen.findByText('PRD-000001')
      expect(screen.queryByRole('button', { name: 'New product' })).toBeNull()
      expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    })
  })

  describe('Inventory Items navigation', () => {
    it('shows the Inventory Items link only when canViewInventoryItems is true', () => {
      installMockApi()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true })}
          onLoggedOut={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: 'Inventory Items' })).toBeDefined()
    })

    it('hides the Inventory Items link when canViewInventoryItems is false', () => {
      installMockApi()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: false })}
          onLoggedOut={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: 'Inventory Items' })).toBeNull()
    })

    it('clicking Inventory Items navigates to the item list', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Inventory Items' }))
      expect(await screen.findByText('No inventory items yet.')).toBeDefined()
    })

    it('New item opens create mode (code/name/category/type/unit form)', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true, canManageInventoryItems: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Inventory Items' }))
      await user.click(await screen.findByRole('button', { name: 'New item' }))
      expect(await screen.findByRole('button', { name: 'Create item' })).toBeDefined()
    })

    it('selecting a row opens detail mode for that item', async () => {
      installMockApi()
      const seededItem = {
        id: 'inventory_item_1',
        code: 'FLOUR',
        name: 'Flour',
        category: 'Dry goods',
        itemType: 'ingredient' as const,
        unitOfMeasureId: 'uom_kg',
        unitOfMeasureLabel: 'kg',
        minimumStock: 10,
        reorderQuantity: 20,
        maximumStock: null,
        leadTimeDays: 3,
        lotTracked: false,
        expiryTracked: false,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.listInventoryItems = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItems: [seededItem] })
      window.ledgerpage.getInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: seededItem })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true, canManageInventoryItems: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Inventory Items' }))
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('Flour')).toBeDefined()
    })

    it('successful creation opens the generated item detail, then Back returns to the list', async () => {
      installMockApi()
      const createdItem = {
        id: 'inventory_item_new',
        code: 'FLOUR',
        name: 'Flour',
        category: 'Dry goods',
        itemType: 'ingredient' as const,
        unitOfMeasureId: 'uom_kg',
        unitOfMeasureLabel: 'kg',
        minimumStock: 10,
        reorderQuantity: 20,
        maximumStock: null,
        leadTimeDays: 3,
        lotTracked: false,
        expiryTracked: false,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.createInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: createdItem })
      window.ledgerpage.getInventoryItem = vi
        .fn()
        .mockResolvedValue({ success: true, inventoryItem: createdItem })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true, canManageInventoryItems: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Inventory Items' }))
      await user.click(await screen.findByRole('button', { name: 'New item' }))
      await user.type(screen.getByLabelText('Code'), 'FLOUR')
      await user.type(screen.getByLabelText('Name'), 'Flour')
      await user.type(screen.getByLabelText('Category'), 'Dry goods')
      await user.click(screen.getByRole('button', { name: 'Create item' }))

      expect(await screen.findByText('Flour')).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('No inventory items yet.')).toBeDefined()
    })

    it('a Finance user (canViewInventoryItems true, canManageInventoryItems false) can navigate and inspect but sees no mutation controls', async () => {
      installMockApi()
      window.ledgerpage.listInventoryItems = vi.fn().mockResolvedValue({
        success: true,
        inventoryItems: [
          {
            id: 'inventory_item_1',
            code: 'FLOUR',
            name: 'Flour',
            category: 'Dry goods',
            itemType: 'ingredient',
            unitOfMeasureId: 'uom_kg',
            unitOfMeasureLabel: 'kg',
            minimumStock: 10,
            reorderQuantity: 20,
            maximumStock: null,
            leadTimeDays: 3,
            lotTracked: false,
            expiryTracked: false,
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now()
          }
        ]
      })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryItems: true, canManageInventoryItems: false })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Inventory Items' }))
      await screen.findByText('FLOUR')
      expect(screen.queryByRole('button', { name: 'New item' })).toBeNull()
      expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    })
  })

  describe('Suppliers navigation', () => {
    it('shows the Suppliers link only when canViewSuppliers is true', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewSuppliers: true })} onLoggedOut={vi.fn()} />
      )
      expect(screen.getByRole('button', { name: 'Suppliers' })).toBeDefined()
    })

    it('hides the Suppliers link when canViewSuppliers is false', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewSuppliers: false })} onLoggedOut={vi.fn()} />
      )
      expect(screen.queryByRole('button', { name: 'Suppliers' })).toBeNull()
    })

    it('clicking Suppliers navigates to the supplier list', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell session={session({ canViewSuppliers: true })} onLoggedOut={vi.fn()} />
      )
      await user.click(screen.getByRole('button', { name: 'Suppliers' }))
      expect(await screen.findByText('No suppliers yet.')).toBeDefined()
    })

    it('New supplier opens create mode', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewSuppliers: true, canManageSuppliers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Suppliers' }))
      await user.click(await screen.findByRole('button', { name: 'New supplier' }))
      expect(await screen.findByRole('button', { name: 'Create supplier' })).toBeDefined()
    })

    it('selecting a row opens detail mode for that supplier', async () => {
      installMockApi()
      const seededSupplier = {
        id: 'supplier_1',
        code: 'SUP-000001',
        name: 'Acme Foods',
        contactDetails: null,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.listSuppliers = vi
        .fn()
        .mockResolvedValue({ success: true, suppliers: [seededSupplier] })
      window.ledgerpage.getSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: seededSupplier })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewSuppliers: true, canManageSuppliers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Suppliers' }))
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('Acme Foods')).toBeDefined()
    })

    it('successful creation opens the generated supplier detail, then Back returns to the list', async () => {
      installMockApi()
      const createdSupplier = {
        id: 'supplier_new',
        code: 'SUP-000001',
        name: 'Acme Foods',
        contactDetails: null,
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.createSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: createdSupplier })
      window.ledgerpage.getSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: createdSupplier })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewSuppliers: true, canManageSuppliers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Suppliers' }))
      await user.click(await screen.findByRole('button', { name: 'New supplier' }))
      await user.type(screen.getByLabelText('Name'), 'Acme Foods')
      await user.click(screen.getByRole('button', { name: 'Create supplier' }))

      expect(await screen.findByText('Acme Foods')).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('No suppliers yet.')).toBeDefined()
    })
  })

  describe('Customers navigation', () => {
    it('shows the Customers link only when canViewCustomers is true', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewCustomers: true })} onLoggedOut={vi.fn()} />
      )
      expect(screen.getByRole('button', { name: 'Customers' })).toBeDefined()
    })

    it('hides the Customers link when canViewCustomers is false', () => {
      installMockApi()
      render(
        <AuthenticatedShell session={session({ canViewCustomers: false })} onLoggedOut={vi.fn()} />
      )
      expect(screen.queryByRole('button', { name: 'Customers' })).toBeNull()
    })

    it('clicking Customers navigates to the customer list', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell session={session({ canViewCustomers: true })} onLoggedOut={vi.fn()} />
      )
      await user.click(screen.getByRole('button', { name: 'Customers' }))
      expect(await screen.findByText('No customers yet.')).toBeDefined()
    })

    it('New customer opens create mode', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewCustomers: true, canManageCustomers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Customers' }))
      await user.click(await screen.findByRole('button', { name: 'New customer' }))
      expect(await screen.findByRole('button', { name: 'Create customer' })).toBeDefined()
    })

    it('selecting a row opens detail mode for that customer', async () => {
      installMockApi()
      const seededCustomer = {
        id: 'customer_1',
        code: 'CUS-000001',
        name: 'Acme Retail',
        contactDetails: null,
        paymentTermsDays: null,
        creditLimitMinor: null,
        currencyId: 'currency_usd',
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.listCustomers = vi
        .fn()
        .mockResolvedValue({ success: true, customers: [seededCustomer] })
      window.ledgerpage.getCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: seededCustomer })
      window.ledgerpage.listContactsForCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, contacts: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewCustomers: true, canManageCustomers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Customers' }))
      await user.click(await screen.findByRole('button', { name: 'Edit' }))
      expect(await screen.findByText('Acme Retail')).toBeDefined()
    })

    it('successful creation opens the generated customer detail, then Back returns to the list', async () => {
      installMockApi()
      const createdCustomer = {
        id: 'customer_new',
        code: 'CUS-000001',
        name: 'Acme Retail',
        contactDetails: null,
        paymentTermsDays: null,
        creditLimitMinor: null,
        currencyId: 'currency_usd',
        isActive: true,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      window.ledgerpage.createCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: createdCustomer })
      window.ledgerpage.getCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: createdCustomer })
      window.ledgerpage.listContactsForCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, contacts: [] })
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewCustomers: true, canManageCustomers: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Customers' }))
      await user.click(await screen.findByRole('button', { name: 'New customer' }))
      await user.type(screen.getByLabelText('Name'), 'Acme Retail')
      await user.click(screen.getByRole('button', { name: 'Create customer' }))

      expect(await screen.findByText('Acme Retail')).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('No customers yet.')).toBeDefined()
    })
  })

  describe('Stock navigation', () => {
    const seededSummary = {
      inventoryItemId: 'inventory_item_1',
      itemCode: 'FLOUR',
      itemName: 'Flour',
      unitCode: 'kg',
      unitName: 'Kilogram',
      decimalPlaces: 3,
      physicalQuantityScaled: 20000,
      reservedQuantityScaled: 0,
      availableQuantityScaled: 20000,
      incomingQuantityScaled: 0,
      formattedPhysicalQuantity: '20.000',
      formattedReservedQuantity: '0.000',
      formattedAvailableQuantity: '20.000',
      formattedIncomingQuantity: '0.000',
      lotCount: 1
    }
    const seededLot = {
      id: 'inventory_lot_1',
      internalLotNumber: 'LOT-000001',
      supplierLotNumber: null,
      inventoryItemId: 'inventory_item_1',
      itemCode: 'FLOUR',
      itemName: 'Flour',
      supplierId: null,
      supplierCode: null,
      supplierName: null,
      receivedDate: Date.now(),
      quantityReceivedScaled: 20000,
      quantityRemainingScaled: 20000,
      formattedQuantityReceived: '20.000',
      formattedQuantityRemaining: '20.000',
      unitCode: 'kg',
      unitName: 'Kilogram',
      decimalPlaces: 3,
      unitCostMinor: 350,
      totalCostMinor: 7000,
      costRemainingMinor: 7000,
      currencyId: 'currency_usd',
      expiryDate: null,
      lifecycleStatus: 'active',
      effectiveStatus: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    function seedStockMocks(): void {
      window.ledgerpage.listStockSummaries = vi
        .fn()
        .mockResolvedValue({ success: true, summaries: [seededSummary] })
      window.ledgerpage.listInventoryLotsForItem = vi
        .fn()
        .mockResolvedValue({ success: true, lots: [seededLot] })
      window.ledgerpage.getInventoryLot = vi
        .fn()
        .mockResolvedValue({ success: true, lot: seededLot })
      window.ledgerpage.listInventoryLotMovements = vi
        .fn()
        .mockResolvedValue({ success: true, movements: [] })
    }

    it('shows the Stock link only when canViewInventoryLots is true', () => {
      installMockApi()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      expect(screen.getByRole('button', { name: 'Stock' })).toBeDefined()
    })

    it('hides the Stock link when canViewInventoryLots is false', () => {
      installMockApi()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: false })}
          onLoggedOut={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: 'Stock' })).toBeNull()
    })

    it('clicking Stock navigates to the stock-on-hand list', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      expect(await screen.findByText('No stock on hand yet.')).toBeDefined()
    })

    it('opening a summary row navigates to that item\u2019s lot list (item-lots), not directly to a lot', async () => {
      installMockApi()
      seedStockMocks()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await user.click(await screen.findByRole('button', { name: 'View lots' }))

      expect(await screen.findByRole('heading', { name: /FLOUR.*Flour/ })).toBeDefined()
      expect(screen.getByText('LOT-000001')).toBeDefined()
    })

    it('opening a lot from item-lots navigates to lot detail', async () => {
      installMockApi()
      seedStockMocks()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await user.click(await screen.findByRole('button', { name: 'View lots' }))
      await user.click(await screen.findByRole('button', { name: 'View' }))

      expect(await screen.findByRole('heading', { name: 'LOT-000001' })).toBeDefined()
    })

    it('Back from lot detail returns to the same item-lots screen (preserving item context)', async () => {
      installMockApi()
      seedStockMocks()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await user.click(await screen.findByRole('button', { name: 'View lots' }))
      await user.click(await screen.findByRole('button', { name: 'View' }))
      await screen.findByRole('heading', { name: 'LOT-000001' })

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByRole('heading', { name: /FLOUR.*Flour/ })).toBeDefined()
    })

    it('Back from item-lots returns to the Stock list', async () => {
      installMockApi()
      seedStockMocks()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await user.click(await screen.findByRole('button', { name: 'View lots' }))
      await screen.findByRole('heading', { name: /FLOUR.*Flour/ })

      await user.click(screen.getByRole('button', { name: 'Back' }))
      expect(await screen.findByText('FLOUR')).toBeDefined()
      expect(await screen.findByRole('button', { name: 'View lots' })).toBeDefined()
    })

    it('multiple lots do not cause an arbitrary lot to be selected -- item-lots shows all of them for the reader to choose', async () => {
      installMockApi()
      const secondLot = {
        ...seededLot,
        id: 'inventory_lot_2',
        internalLotNumber: 'LOT-000002'
      }
      window.ledgerpage.listStockSummaries = vi
        .fn()
        .mockResolvedValue({ success: true, summaries: [seededSummary] })
      window.ledgerpage.listInventoryLotsForItem = vi
        .fn()
        .mockResolvedValue({ success: true, lots: [seededLot, secondLot] })

      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await user.click(await screen.findByRole('button', { name: 'View lots' }))

      // Both lots are shown -- neither was silently auto-opened.
      expect(await screen.findByText('LOT-000001')).toBeDefined()
      expect(screen.getByText('LOT-000002')).toBeDefined()
    })

    it('Finance (view only, per the approved matrix) can view Stock', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({
            canViewInventoryLots: true,
            canManageInventoryLots: false,
            canOverrideInventoryLots: false
          })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      expect(await screen.findByText('No stock on hand yet.')).toBeDefined()
    })

    it('Operations (manage, no override, per the approved matrix) can view Stock', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({
            canViewInventoryLots: true,
            canManageInventoryLots: true,
            canOverrideInventoryLots: false
          })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      expect(await screen.findByText('No stock on hand yet.')).toBeDefined()
    })

    it('no create/edit route exists for Stock -- no such button ever renders', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(
        <AuthenticatedShell
          session={session({ canViewInventoryLots: true, canManageInventoryLots: true })}
          onLoggedOut={vi.fn()}
        />
      )
      await user.click(screen.getByRole('button', { name: 'Stock' }))
      await screen.findByText('No stock on hand yet.')
      expect(screen.queryByRole('button', { name: /new/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /create/i })).toBeNull()
    })
  })
  describe('Accounting navigation', () => {
    const seededAccount = {
      id: 'account_1',
      code: '1000',
      name: 'Cash on Hand',
      category: 'asset',
      subtype: 'cash',
      normalBalance: 'debit',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const seededRevenueAccount = {
      id: 'account_2',
      code: '4000',
      name: 'Sales Revenue',
      category: 'revenue',
      subtype: 'sales',
      normalBalance: 'credit',
      isActive: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const seededEntry = {
      id: 'journal_entry_1',
      entryNumber: 'JE-2026-000001',
      entryDate: Date.now(),
      description: 'Cash sale',
      externalReference: null,
      currencyId: 'currency_usd',
      createdByUserId: 'user_1',
      createdByLabel: 'Ben',
      reversedEntryId: null,
      reversalReason: null,
      hasBeenReversed: false,
      createdAt: Date.now(),
      lines: [
        {
          id: 'l1',
          accountId: 'account_1',
          accountCode: '1000',
          accountName: 'Cash on Hand',
          debitMinor: 1000,
          creditMinor: 0,
          description: null,
          lineOrder: 0
        },
        {
          id: 'l2',
          accountId: 'account_2',
          accountCode: '4000',
          accountName: 'Sales Revenue',
          debitMinor: 0,
          creditMinor: 1000,
          description: null,
          lineOrder: 1
        }
      ]
    }

    function seedAccountingMocks(): void {
      window.ledgerpage.listAccounts = vi
        .fn()
        .mockResolvedValue({ success: true, accounts: [seededAccount, seededRevenueAccount] })
      window.ledgerpage.listJournalEntries = vi
        .fn()
        .mockResolvedValue({ success: true, entries: [seededEntry] })
      window.ledgerpage.getJournalEntry = vi
        .fn()
        .mockResolvedValue({ success: true, entry: seededEntry })
      window.ledgerpage.getTrialBalance = vi.fn().mockResolvedValue({
        success: true,
        trialBalance: {
          accounts: [],
          grandTotalDebitMinor: 0,
          grandTotalCreditMinor: 0,
          isBalanced: true
        }
      })
    }

    describe('Owner', () => {
      it('sees the Accounting nav, which opens Chart of Accounts by default', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        expect(screen.getByRole('button', { name: 'Accounting' })).toBeDefined()
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        expect((await screen.findAllByText('Chart of Accounts')).length).toBeGreaterThan(0)
        expect(await screen.findByText('1000')).toBeDefined()
      })

      it('all three sub-nav tabs are visible', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await screen.findByText('1000')
        expect(screen.getByRole('button', { name: 'Chart of Accounts' })).toBeDefined()
        expect(screen.getByRole('button', { name: 'Journal Entries' })).toBeDefined()
        expect(screen.getByRole('button', { name: 'Trial Balance' })).toBeDefined()
      })

      it('account manage controls are visible', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await screen.findByText('1000')
        expect(screen.getByRole('button', { name: 'New account' })).toBeDefined()
        expect(screen.getAllByRole('button', { name: 'Edit' }).length).toBeGreaterThan(0)
      })

      it('New Manual Journal is visible on the Journal Entries tab', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        expect(await screen.findByRole('button', { name: 'New Manual Journal' })).toBeDefined()
      })

      it('reversal controls are allowed on a journal detail', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000001'))
        expect(await screen.findByRole('button', { name: 'Reverse entry' })).toBeDefined()
      })
    })

    describe('Executive', () => {
      function executiveSession() {
        return session({
          canViewAccounts: true,
          canManageAccounts: false,
          canViewJournalEntries: true,
          canManageJournalEntries: false
        })
      }

      it('sees the Accounting nav and can access Chart/Journals/Trial Balance', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(<AuthenticatedShell session={executiveSession()} onLoggedOut={vi.fn()} />)
        expect(screen.getByRole('button', { name: 'Accounting' })).toBeDefined()
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        expect(await screen.findByText('1000')).toBeDefined()
        await user.click(screen.getByRole('button', { name: 'Journal Entries' }))
        expect(await screen.findByText('JE-2026-000001')).toBeDefined()
        await user.click(screen.getByRole('button', { name: 'Trial Balance' }))
        expect(await screen.findByText('Grand total')).toBeDefined()
      })

      it('no New Account, Edit, Deactivate, or Reactivate control on Chart of Accounts', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(<AuthenticatedShell session={executiveSession()} onLoggedOut={vi.fn()} />)
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await screen.findByText('1000')
        expect(screen.queryByRole('button', { name: 'New account' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
        expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
      })

      it('no New Manual Journal on Journal Entries', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(<AuthenticatedShell session={executiveSession()} onLoggedOut={vi.fn()} />)
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await screen.findByText('JE-2026-000001')
        expect(screen.queryByRole('button', { name: 'New Manual Journal' })).toBeNull()
      })

      it('no reversal control on journal detail', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(<AuthenticatedShell session={executiveSession()} onLoggedOut={vi.fn()} />)
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000001'))
        await screen.findByText('JE-2026-000001')
        expect(screen.queryByRole('button', { name: 'Reverse entry' })).toBeNull()
      })
    })

    describe('Operations', () => {
      it('the Accounting nav is completely absent', () => {
        installMockApi()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: false,
              canManageAccounts: false,
              canViewJournalEntries: false,
              canManageJournalEntries: false
            })}
            onLoggedOut={vi.fn()}
          />
        )
        expect(screen.queryByRole('button', { name: 'Accounting' })).toBeNull()
      })
    })

    describe('Finance', () => {
      it('sees the Accounting nav with account and journal management controls', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        expect(screen.getByRole('button', { name: 'Accounting' })).toBeDefined()
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await screen.findByText('1000')
        expect(screen.getByRole('button', { name: 'New account' })).toBeDefined()

        await user.click(screen.getByRole('button', { name: 'Journal Entries' }))
        expect(await screen.findByRole('button', { name: 'New Manual Journal' })).toBeDefined()
      })
    })

    describe('routing', () => {
      it('Chart tab -> accounts, Journal Entries tab -> journals, Trial Balance tab -> trial balance', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({ canViewAccounts: true, canViewJournalEntries: true })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        expect((await screen.findAllByText('Chart of Accounts')).length).toBeGreaterThan(0)

        await user.click(screen.getByRole('button', { name: 'Journal Entries' }))
        expect(await screen.findByText('JE-2026-000001')).toBeDefined()

        await user.click(screen.getByRole('button', { name: 'Trial Balance' }))
        expect(await screen.findByText('Grand total')).toBeDefined()
      })

      it('New Manual Journal -> journal-create, Back -> journals', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByRole('button', { name: 'New Manual Journal' }))
        expect(await screen.findByText('New Manual Journal')).toBeDefined()

        await user.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByText('JE-2026-000001')).toBeDefined()
      })

      it('a successful journal creation navigates to journal-detail for the returned ID', async () => {
        installMockApi()
        seedAccountingMocks()
        const newEntry = {
          ...seededEntry,
          id: 'journal_entry_new',
          entryNumber: 'JE-2026-000099'
        }
        window.ledgerpage.createJournalEntry = vi
          .fn()
          .mockResolvedValue({ success: true, entry: newEntry })
        window.ledgerpage.getJournalEntry = vi.fn().mockImplementation((input: { id: string }) => {
          const entry = input.id === newEntry.id ? newEntry : seededEntry
          return Promise.resolve({ success: true, entry })
        })
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByRole('button', { name: 'New Manual Journal' }))
        await screen.findByText('New Manual Journal')

        await user.type(screen.getByLabelText('Description'), 'Cash sale')
        const accountSelects = screen.getAllByLabelText('Account')
        await user.selectOptions(accountSelects[0], 'account_1')
        await user.selectOptions(accountSelects[1], 'account_2')
        await user.type(screen.getAllByLabelText('Debit')[0], '10.00')
        await user.type(screen.getAllByLabelText('Credit')[1], '10.00')
        await user.click(screen.getByRole('button', { name: 'Post journal entry' }))

        expect(await screen.findByText('JE-2026-000099')).toBeDefined()
      })

      it('clicking a journal row navigates to journal-detail for that exact ID', async () => {
        installMockApi()
        seedAccountingMocks()
        const secondEntry = { ...seededEntry, id: 'journal_entry_2', entryNumber: 'JE-2026-000002' }
        window.ledgerpage.listJournalEntries = vi
          .fn()
          .mockResolvedValue({ success: true, entries: [seededEntry, secondEntry] })
        window.ledgerpage.getJournalEntry = vi.fn().mockImplementation((input: { id: string }) => {
          const entry = input.id === secondEntry.id ? secondEntry : seededEntry
          return Promise.resolve({ success: true, entry })
        })
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({ canViewAccounts: true, canViewJournalEntries: true })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000002'))

        expect(window.ledgerpage.getJournalEntry).toHaveBeenCalledWith({ id: 'journal_entry_2' })
      })

      it('Back from journal-detail returns to journals', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({ canViewAccounts: true, canViewJournalEntries: true })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000001'))
        await screen.findByText('JE-2026-000001')

        await user.click(screen.getByRole('button', { name: 'Back' }))
        expect(await screen.findByLabelText('Search journal entries')).toBeDefined()
      })

      it('a successful reversal navigates to journal-detail for the new reversal ID', async () => {
        installMockApi()
        seedAccountingMocks()
        const reversalEntry = {
          ...seededEntry,
          id: 'journal_entry_reversal',
          entryNumber: 'JE-2026-000077',
          reversedEntryId: seededEntry.id,
          reversalReason: 'Undo'
        }
        window.ledgerpage.reverseJournalEntry = vi
          .fn()
          .mockResolvedValue({ success: true, entry: reversalEntry })
        window.ledgerpage.getJournalEntry = vi.fn().mockImplementation((input: { id: string }) => {
          const entry = input.id === reversalEntry.id ? reversalEntry : seededEntry
          return Promise.resolve({ success: true, entry })
        })
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000001'))
        await user.click(await screen.findByRole('button', { name: 'Reverse entry' }))
        await user.type(screen.getByLabelText('Reversal reason'), 'Undo')
        await user.click(screen.getByRole('button', { name: 'Confirm reversal' }))

        expect(await screen.findByText('JE-2026-000077')).toBeDefined()
      })
    })

    describe('structural routing', () => {
      it('no journal edit, journal delete, draft-journal, or accounting-period route/control exists anywhere', async () => {
        installMockApi()
        seedAccountingMocks()
        const user = userEvent.setup()
        render(
          <AuthenticatedShell
            session={session({
              canViewAccounts: true,
              canManageAccounts: true,
              canViewJournalEntries: true,
              canManageJournalEntries: true
            })}
            onLoggedOut={vi.fn()}
          />
        )
        await user.click(screen.getByRole('button', { name: 'Accounting' }))
        await user.click(await screen.findByRole('button', { name: 'Journal Entries' }))
        await user.click(await screen.findByText('JE-2026-000001'))
        await screen.findByText('JE-2026-000001')

        expect(screen.queryByRole('button', { name: /edit journal/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /delete journal/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /draft/i })).toBeNull()
        expect(screen.queryByRole('button', { name: /period/i })).toBeNull()
        expect(screen.queryByLabelText(/period/i)).toBeNull()
      })
    })
  })
})

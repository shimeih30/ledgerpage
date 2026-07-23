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
    listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] })
  }
}

function session(overrides: Partial<SafeSessionInfo>): SafeSessionInfo {
  return {
    displayName: 'Ben',
    isOwner: false,
    canViewAuditLog: false,
    canViewProducts: false,
    canManageProducts: false,
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
})

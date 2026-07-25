// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SupplierListScreen } from '../../src/renderer/src/suppliers/SupplierListScreen'
import type { SafeSupplier } from '../../src/shared/ipc/suppliers'

afterEach(() => {
  cleanup()
})

function makeSupplier(overrides: Partial<SafeSupplier> = {}): SafeSupplier {
  return {
    id: 'supplier_1',
    code: 'SUP-000001',
    name: 'Acme Foods',
    contactDetails: 'buyer@acme.com',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listSuppliers?: ReturnType<typeof vi.fn>
    deactivateSupplier?: ReturnType<typeof vi.fn>
    reactivateSupplier?: ReturnType<typeof vi.fn>
  } = {}
) {
  const api = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState: vi.fn(),
    unlockSession: vi.fn(),
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn(),
    listAuditEntries: vi.fn(),
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
    listAssignableTaxCodes: vi.fn(),
    listInventoryItems: vi.fn(),
    getInventoryItem: vi.fn(),
    createInventoryItem: vi.fn(),
    updateInventoryItem: vi.fn(),
    deactivateInventoryItem: vi.fn(),
    reactivateInventoryItem: vi.fn(),
    listAssignableUnitsOfMeasure: vi.fn(),
    listSuppliers:
      overrides.listSuppliers ?? vi.fn().mockResolvedValue({ success: true, suppliers: [] }),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: overrides.deactivateSupplier ?? vi.fn(),
    reactivateSupplier: overrides.reactivateSupplier ?? vi.fn(),
    recordSupplierPrice: vi.fn(),
    listPricesForSupplier: vi.fn(),
    listPricesForInventoryItem: vi.fn(),
    getCurrentSupplierItemPrice: vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onOpenSupplier/onCreateSupplier in tests that don't assert them
}

describe('SupplierListScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [makeSupplier()] })
    })
    render(<SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('SUP-000001')).toBeDefined()
    expect(screen.getByText('Acme Foods')).toBeDefined()
    expect(screen.getByText('buyer@acme.com')).toBeDefined()
  })

  it('shows an empty state when there are no suppliers', async () => {
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [] })
    })
    render(<SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />)

    expect(await screen.findByText('No suppliers yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />)

    expect(
      await screen.findByText('Couldn\u2019t load suppliers. Try reloading the app.')
    ).toBeDefined()
  })

  it('displays a dash when contact details are null, never a raw null/undefined', async () => {
    installMockApi({
      listSuppliers: vi
        .fn()
        .mockResolvedValue({ success: true, suppliers: [makeSupplier({ contactDetails: null })] })
    })
    render(<SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />)

    await screen.findByText('SUP-000001')
    expect(screen.getByText('\u2014')).toBeDefined()
    expect(screen.queryByText('null')).toBeNull()
    expect(screen.queryByText('undefined')).toBeNull()
  })

  it('a manager sees New supplier and mutation actions', async () => {
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [makeSupplier()] })
    })
    render(<SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />)

    await screen.findByText('SUP-000001')
    expect(screen.getByRole('button', { name: 'New supplier' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDefined()
  })

  it('canManageSuppliers=false (defensive renderer-capability test) shows no New supplier button and only a View action', async () => {
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [makeSupplier()] })
    })
    render(
      <SupplierListScreen
        canManageSuppliers={false}
        onOpenSupplier={noop}
        onCreateSupplier={noop}
      />
    )

    await screen.findByText('SUP-000001')
    expect(screen.queryByRole('button', { name: 'New supplier' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
  })

  it('opening details invokes onOpenSupplier with the supplier id (View action works)', async () => {
    const onOpenSupplier = vi.fn()
    installMockApi({
      listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [makeSupplier()] })
    })
    render(
      <SupplierListScreen
        canManageSuppliers={false}
        onOpenSupplier={onOpenSupplier}
        onCreateSupplier={noop}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'View' }))
    expect(onOpenSupplier).toHaveBeenCalledWith('supplier_1')
  })

  describe('deactivate/reactivate: authoritative refresh, never optimistic', () => {
    it('waits for IPC success before changing visible state, then reloads from a fresh listSuppliers call', async () => {
      const listSuppliers = vi
        .fn()
        .mockResolvedValueOnce({ success: true, suppliers: [makeSupplier({ isActive: true })] })
        .mockResolvedValueOnce({ success: true, suppliers: [makeSupplier({ isActive: false })] })
      const deactivateSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: makeSupplier({ isActive: false }) })
      installMockApi({ listSuppliers, deactivateSupplier })
      render(
        <SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await waitFor(() => expect(listSuppliers).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Inactive')).toBeDefined()
    })

    it('a failed mutation leaves the existing row unchanged -- no second listSuppliers call, no optimistic state mutation', async () => {
      const listSuppliers = vi
        .fn()
        .mockResolvedValue({ success: true, suppliers: [makeSupplier({ isActive: true })] })
      const deactivateSupplier = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ listSuppliers, deactivateSupplier })
      render(
        <SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />
      )

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await screen.findByText('Something went wrong. Try again.')
      expect(screen.getByText('Active')).toBeDefined()
      expect(listSuppliers).toHaveBeenCalledTimes(1)
    })

    it('repeated rapid clicks while a mutation is in flight produce exactly one IPC call', async () => {
      let resolveDeactivate: (value: unknown) => void = () => {}
      const deactivateSupplier = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDeactivate = resolve
        })
      )
      installMockApi({
        listSuppliers: vi.fn().mockResolvedValue({ success: true, suppliers: [makeSupplier()] }),
        deactivateSupplier
      })
      render(
        <SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />
      )

      await screen.findByText('Active')
      const button = screen.getByRole('button', { name: 'Deactivate' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(deactivateSupplier).toHaveBeenCalledTimes(1)
      resolveDeactivate({ success: true, supplier: makeSupplier({ isActive: false }) })
    })

    it('reactivate follows the same authoritative-refresh rule', async () => {
      const listSuppliers = vi
        .fn()
        .mockResolvedValueOnce({ success: true, suppliers: [makeSupplier({ isActive: false })] })
        .mockResolvedValueOnce({ success: true, suppliers: [makeSupplier({ isActive: true })] })
      const reactivateSupplier = vi
        .fn()
        .mockResolvedValue({ success: true, supplier: makeSupplier({ isActive: true }) })
      installMockApi({ listSuppliers, reactivateSupplier })
      render(
        <SupplierListScreen canManageSuppliers onOpenSupplier={noop} onCreateSupplier={noop} />
      )

      await screen.findByText('Inactive')
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))

      await waitFor(() => expect(listSuppliers).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Active')).toBeDefined()
    })
  })
})

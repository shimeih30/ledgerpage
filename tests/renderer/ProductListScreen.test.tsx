// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProductListScreen } from '../../src/renderer/src/products/ProductListScreen'
import type { SafeProduct } from '../../src/shared/ipc/products'

afterEach(() => {
  cleanup()
})

function makeProduct(overrides: Partial<SafeProduct> = {}): SafeProduct {
  return {
    id: 'product_1',
    code: 'PRD-000001',
    name: 'Jam',
    type: 'manufactured',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function installMockApi(
  overrides: {
    listProducts?: ReturnType<typeof vi.fn>
    deactivateProduct?: ReturnType<typeof vi.fn>
    reactivateProduct?: ReturnType<typeof vi.fn>
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
    listProducts:
      overrides.listProducts ?? vi.fn().mockResolvedValue({ success: true, products: [] }),
    getProduct: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deactivateProduct: overrides.deactivateProduct ?? vi.fn(),
    reactivateProduct: overrides.reactivateProduct ?? vi.fn(),
    listVariantsForProduct: vi.fn(),
    getVariant: vi.fn(),
    createVariant: vi.fn(),
    updateVariant: vi.fn(),
    deactivateVariant: vi.fn(),
    reactivateVariant: vi.fn(),
    listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] })
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onOpenProduct/onCreateProduct in tests that don't assert them
}

describe('ProductListScreen', () => {
  it('shows a loading state, then the rendered rows', async () => {
    installMockApi({
      listProducts: vi.fn().mockResolvedValue({ success: true, products: [makeProduct()] })
    })
    render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('PRD-000001')).toBeDefined()
    expect(screen.getByText('Jam')).toBeDefined()
  })

  it('shows an empty state when there are no products', async () => {
    installMockApi({ listProducts: vi.fn().mockResolvedValue({ success: true, products: [] }) })
    render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

    expect(await screen.findByText('No products yet.')).toBeDefined()
  })

  it('shows a safe error message on failure, never a raw exception', async () => {
    installMockApi({
      listProducts: vi.fn().mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
    })
    render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

    expect(
      await screen.findByText('Couldn\u2019t load products. Try reloading the app.')
    ).toBeDefined()
  })

  it('a manager sees New product and mutation actions', async () => {
    installMockApi({
      listProducts: vi.fn().mockResolvedValue({ success: true, products: [makeProduct()] })
    })
    render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

    await screen.findByText('PRD-000001')
    expect(screen.getByRole('button', { name: 'New product' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDefined()
  })

  it('Finance (read-only) sees no New product button and only a View action', async () => {
    installMockApi({
      listProducts: vi.fn().mockResolvedValue({ success: true, products: [makeProduct()] })
    })
    render(
      <ProductListScreen canManageProducts={false} onOpenProduct={noop} onCreateProduct={noop} />
    )

    await screen.findByText('PRD-000001')
    expect(screen.queryByRole('button', { name: 'New product' })).toBeNull()
    expect(screen.getByRole('button', { name: 'View' })).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
  })

  it('opening details invokes onOpenProduct with the product id', async () => {
    const onOpenProduct = vi.fn()
    installMockApi({
      listProducts: vi.fn().mockResolvedValue({ success: true, products: [makeProduct()] })
    })
    render(
      <ProductListScreen canManageProducts onOpenProduct={onOpenProduct} onCreateProduct={noop} />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(onOpenProduct).toHaveBeenCalledWith('product_1')
  })

  describe('deactivate/reactivate: authoritative refresh, never optimistic', () => {
    it('waits for IPC success before changing visible state, then reloads from a fresh listProducts call', async () => {
      const listProducts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, products: [makeProduct({ isActive: true })] })
        .mockResolvedValueOnce({ success: true, products: [makeProduct({ isActive: false })] })
      const deactivateProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ isActive: false }) })
      installMockApi({ listProducts, deactivateProduct })
      render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      // The success path must call listProducts again (authoritative
      // reload) rather than locally flipping the badge from the
      // deactivateProduct response alone.
      await waitFor(() => expect(listProducts).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Inactive')).toBeDefined()
    })

    it('a failed mutation leaves the existing row unchanged -- no second listProducts call', async () => {
      const listProducts = vi
        .fn()
        .mockResolvedValue({ success: true, products: [makeProduct({ isActive: true })] })
      const deactivateProduct = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ listProducts, deactivateProduct })
      render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

      await screen.findByText('Active')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))

      await screen.findByText('Something went wrong. Try again.')
      // Still shows Active -- the row was never touched.
      expect(screen.getByText('Active')).toBeDefined()
      expect(listProducts).toHaveBeenCalledTimes(1)
    })

    it('repeated rapid clicks while a mutation is in flight produce exactly one IPC call', async () => {
      let resolveDeactivate: (value: unknown) => void = () => {}
      const deactivateProduct = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveDeactivate = resolve
        })
      )
      installMockApi({
        listProducts: vi.fn().mockResolvedValue({ success: true, products: [makeProduct()] }),
        deactivateProduct
      })
      render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

      await screen.findByText('Active')
      const button = screen.getByRole('button', { name: 'Deactivate' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(deactivateProduct).toHaveBeenCalledTimes(1)
      resolveDeactivate({ success: true, product: makeProduct({ isActive: false }) })
    })

    it('reactivate follows the same authoritative-refresh rule', async () => {
      const listProducts = vi
        .fn()
        .mockResolvedValueOnce({ success: true, products: [makeProduct({ isActive: false })] })
        .mockResolvedValueOnce({ success: true, products: [makeProduct({ isActive: true })] })
      const reactivateProduct = vi
        .fn()
        .mockResolvedValue({ success: true, product: makeProduct({ isActive: true }) })
      installMockApi({ listProducts, reactivateProduct })
      render(<ProductListScreen canManageProducts onOpenProduct={noop} onCreateProduct={noop} />)

      await screen.findByText('Inactive')
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))

      await waitFor(() => expect(listProducts).toHaveBeenCalledTimes(2))
      expect(await screen.findByText('Active')).toBeDefined()
    })
  })
})

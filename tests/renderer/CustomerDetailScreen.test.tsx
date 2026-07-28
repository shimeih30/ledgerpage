// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CustomerDetailScreen } from '../../src/renderer/src/customers/CustomerDetailScreen'
import type { SafeCustomer, SafeCustomerContact } from '../../src/shared/ipc/customers'

afterEach(() => {
  cleanup()
})

function makeCustomer(overrides: Partial<SafeCustomer> = {}): SafeCustomer {
  return {
    id: 'customer_1',
    code: 'CUS-000001',
    name: 'Acme Retail',
    contactDetails: null,
    paymentTermsDays: null,
    creditLimitMinor: null,
    currencyId: 'currency_usd',
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

function makeContact(overrides: Partial<SafeCustomerContact> = {}): SafeCustomerContact {
  return {
    id: 'contact_1',
    customerId: 'customer_1',
    name: 'Jane Doe',
    role: null,
    phone: null,
    email: null,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides
  }
}

interface MockApiOverrides {
  getCustomer?: ReturnType<typeof vi.fn>
  createCustomer?: ReturnType<typeof vi.fn>
  updateCustomer?: ReturnType<typeof vi.fn>
  deactivateCustomer?: ReturnType<typeof vi.fn>
  reactivateCustomer?: ReturnType<typeof vi.fn>
  listContactsForCustomer?: ReturnType<typeof vi.fn>
  createCustomerContact?: ReturnType<typeof vi.fn>
  updateCustomerContact?: ReturnType<typeof vi.fn>
  deactivateCustomerContact?: ReturnType<typeof vi.fn>
  reactivateCustomerContact?: ReturnType<typeof vi.fn>
}

function installMockApi(overrides: MockApiOverrides = {}) {
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
    listSuppliers: vi.fn(),
    getSupplier: vi.fn(),
    createSupplier: vi.fn(),
    updateSupplier: vi.fn(),
    deactivateSupplier: vi.fn(),
    reactivateSupplier: vi.fn(),
    recordSupplierPrice: vi.fn(),
    listPricesForSupplier: vi.fn(),
    listPricesForInventoryItem: vi.fn(),
    getCurrentSupplierItemPrice: vi.fn(),
    listCustomers: vi.fn(),
    getCustomer:
      overrides.getCustomer ??
      vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() }),
    createCustomer: overrides.createCustomer ?? vi.fn(),
    updateCustomer: overrides.updateCustomer ?? vi.fn(),
    deactivateCustomer: overrides.deactivateCustomer ?? vi.fn(),
    reactivateCustomer: overrides.reactivateCustomer ?? vi.fn(),
    listContactsForCustomer:
      overrides.listContactsForCustomer ??
      vi.fn().mockResolvedValue({ success: true, contacts: [] }),
    getCustomerContact: vi.fn(),
    createCustomerContact: overrides.createCustomerContact ?? vi.fn(),
    updateCustomerContact: overrides.updateCustomerContact ?? vi.fn(),
    deactivateCustomerContact: overrides.deactivateCustomerContact ?? vi.fn(),
    reactivateCustomerContact: overrides.reactivateCustomerContact ?? vi.fn()
  }
  window.ledgerpage = api as unknown as typeof window.ledgerpage
  return api
}

const noop = (): void => {
  // used as onBack/onSaved in tests that don't assert navigation
}

describe('CustomerDetailScreen', () => {
  describe('loading an existing customer', () => {
    it('shows a loading state, then the loaded customer', async () => {
      installMockApi({
        getCustomer: vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      expect(screen.getByText('Loading\u2026')).toBeDefined()
      expect(await screen.findByText('CUS-000001')).toBeDefined()
    })

    it('shows a safe error message on a load failure', async () => {
      installMockApi({
        getCustomer: vi.fn().mockResolvedValue({ success: false, errorCode: 'not_found' })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      expect(
        await screen.findByText('Couldn\u2019t load this customer. Try reloading the app.')
      ).toBeDefined()
    })
  })

  describe('create mode', () => {
    it('submits only name, contactDetails, paymentTermsDays, and creditLimitMinor -- no code or currencyId', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.change(screen.getByLabelText('Contact details (optional)'), {
        target: { value: 'buyer@acme.com' }
      })
      fireEvent.change(screen.getByLabelText('Payment terms (days, optional)'), {
        target: { value: '30' }
      })
      fireEvent.change(screen.getByLabelText('Credit limit (optional)'), {
        target: { value: '10.29' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
      const callArg = createCustomer.mock.calls[0][0]
      expect(callArg).toEqual({
        name: 'Acme Retail',
        contactDetails: 'buyer@acme.com',
        paymentTermsDays: 30,
        creditLimitMinor: 1029
      })
      expect(callArg).not.toHaveProperty('code')
      expect(callArg).not.toHaveProperty('currencyId')
      expect(callArg).not.toHaveProperty('companyId')
      expect(callArg).not.toHaveProperty('actor')
      expect(callArg).not.toHaveProperty('sessionId')
      expect(callArg).not.toHaveProperty('isActive')
      expect(callArg).not.toHaveProperty('createdAt')
      expect(callArg).not.toHaveProperty('updatedAt')
    })

    it('blank contactDetails is submitted as an empty string, normalized to null server-side', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
      expect(createCustomer.mock.calls[0][0].contactDetails).toBe('')
    })

    it('blank payment terms becomes null', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
      expect(createCustomer.mock.calls[0][0].paymentTermsDays).toBeNull()
    })

    it('0 payment terms (immediate payment) is accepted', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.change(screen.getByLabelText('Payment terms (days, optional)'), {
        target: { value: '0' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
      expect(createCustomer.mock.calls[0][0].paymentTermsDays).toBe(0)
    })

    it.each(['-1', '1.5', '+5', 'abc'])(
      'rejects invalid payment terms "%s" and never submits',
      async (value) => {
        const createCustomer = vi.fn()
        installMockApi({ createCustomer })
        render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Name'), {
          target: { value: 'Acme Retail' }
        })
        fireEvent.change(screen.getByLabelText('Payment terms (days, optional)'), {
          target: { value }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

        expect(await screen.findByText(/payment-term days/i)).toBeDefined()
        expect(createCustomer).not.toHaveBeenCalled()
      }
    )

    it('blank credit limit becomes null', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
      expect(createCustomer.mock.calls[0][0].creditLimitMinor).toBeNull()
    })

    describe('exact credit-limit conversion', () => {
      it.each([
        ['10.29', 1029],
        ['0.29', 29],
        ['0', 0]
      ])('parses "%s" to exactly %i minor units', async (input, expectedMinor) => {
        const createCustomer = vi
          .fn()
          .mockResolvedValue({ success: true, customer: makeCustomer() })
        installMockApi({ createCustomer })
        render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

        fireEvent.change(await screen.findByLabelText('Name'), {
          target: { value: 'Acme Retail' }
        })
        fireEvent.change(screen.getByLabelText('Credit limit (optional)'), {
          target: { value: input }
        })
        fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

        await waitFor(() => expect(createCustomer).toHaveBeenCalledTimes(1))
        expect(createCustomer.mock.calls[0][0].creditLimitMinor).toBe(expectedMinor)
      })

      it.each(['1.005', '-5', '+5', '10.299'])(
        'rejects invalid credit limit "%s" and never submits',
        async (value) => {
          const createCustomer = vi.fn()
          installMockApi({ createCustomer })
          render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

          fireEvent.change(await screen.findByLabelText('Name'), {
            target: { value: 'Acme Retail' }
          })
          fireEvent.change(screen.getByLabelText('Credit limit (optional)'), {
            target: { value }
          })
          fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

          expect(await screen.findByText(/Enter a valid credit limit/i)).toBeDefined()
          expect(createCustomer).not.toHaveBeenCalled()
        }
      )
    })

    it('displays the generated customer code after creation and calls onSaved', async () => {
      const createCustomer = vi.fn().mockResolvedValue({ success: true, customer: makeCustomer() })
      const onSaved = vi.fn()
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={onSaved} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      expect(await screen.findByText('CUS-000001')).toBeDefined()
      expect(onSaved).toHaveBeenCalledWith('customer_1')
    })

    it('preserves entered values after an IPC error', async () => {
      const createCustomer = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      fireEvent.change(screen.getByLabelText('Contact details (optional)'), {
        target: { value: 'buyer@acme.com' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create customer' }))

      await screen.findByText('Something went wrong. Try again.')
      expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Acme Retail')
      expect((screen.getByLabelText('Contact details (optional)') as HTMLInputElement).value).toBe(
        'buyer@acme.com'
      )
    })

    it('prevents double submission: rapid repeated clicks produce exactly one IPC call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createCustomer = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createCustomer })
      render(<CustomerDetailScreen canManageCustomers onBack={noop} onSaved={noop} />)

      fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Acme Retail' } })
      const button = screen.getByRole('button', { name: 'Create customer' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(createCustomer).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, customer: makeCustomer() })
    })
  })

  describe('existing customer mode', () => {
    it('code is read-only after creation -- no Code input exists', async () => {
      installMockApi()
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      expect(await screen.findByText('CUS-000001')).toBeDefined()
      expect(screen.queryByLabelText('Code')).toBeNull()
    })

    it('update submits only editable fields, never code', async () => {
      const updateCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: makeCustomer({ name: 'Renamed' }) })
      installMockApi({ updateCustomer })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      const nameInput = await screen.findByLabelText('Name')
      fireEvent.change(nameInput, { target: { value: 'Renamed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => expect(updateCustomer).toHaveBeenCalledTimes(1))
      const callArg = updateCustomer.mock.calls[0][0]
      expect(callArg).not.toHaveProperty('code')
      expect(callArg.name).toBe('Renamed')
      expect(callArg.customerId).toBe('customer_1')
    })

    it('existing minor units format correctly back into decimal text', async () => {
      installMockApi({
        getCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, customer: makeCustomer({ creditLimitMinor: 1029 }) })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      const creditInput = (await screen.findByLabelText(
        'Credit limit (optional)'
      )) as HTMLInputElement
      expect(creditInput.value).toBe('10.29')
    })

    it('deactivate/reactivate customer', async () => {
      const deactivateCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: false }) })
      const reactivateCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: true }) })
      installMockApi({ deactivateCustomer, reactivateCustomer })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Deactivate customer' }))
      await waitFor(() =>
        expect(deactivateCustomer).toHaveBeenCalledWith({ customerId: 'customer_1' })
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Reactivate customer' }))
      await waitFor(() =>
        expect(reactivateCustomer).toHaveBeenCalledWith({ customerId: 'customer_1' })
      )
    })

    it('read-only mode has no mutating controls', async () => {
      installMockApi()
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers={false}
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('CUS-000001')
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate customer' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate customer' })).toBeNull()
      expect(screen.queryByLabelText('Name')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()
    })

    it('there is no currency selector anywhere on this screen', async () => {
      installMockApi()
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      await screen.findByText('CUS-000001')
      expect(screen.queryByLabelText(/currency/i)).toBeNull()
    })
  })

  describe('contacts', () => {
    it('shows an empty state when there are no contacts', async () => {
      installMockApi({
        listContactsForCustomer: vi.fn().mockResolvedValue({ success: true, contacts: [] })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      expect(await screen.findByText('No contacts yet.')).toBeDefined()
    })

    it('renders both active and inactive contacts', async () => {
      installMockApi({
        listContactsForCustomer: vi.fn().mockResolvedValue({
          success: true,
          contacts: [
            makeContact({ id: 'contact_active', name: 'Active Contact', isActive: true }),
            makeContact({ id: 'contact_inactive', name: 'Inactive Contact', isActive: false })
          ]
        })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      expect(await screen.findByText('Active Contact')).toBeDefined()
      expect(screen.getByText('Inactive Contact')).toBeDefined()
    })

    it('creates a contact with the entered fields', async () => {
      const createCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact() })
      installMockApi({ createCustomerContact })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add contact' }))
      fireEvent.change(document.getElementById('contact-name') as HTMLInputElement, {
        target: { value: 'Jane Doe' }
      })
      fireEvent.change(screen.getByLabelText('Role (optional)'), { target: { value: 'Manager' } })
      fireEvent.change(screen.getByLabelText('Phone (optional)'), {
        target: { value: '555-1234' }
      })
      fireEvent.change(screen.getByLabelText('Email (optional)'), {
        target: { value: 'jane@acme.com' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

      await waitFor(() => expect(createCustomerContact).toHaveBeenCalledTimes(1))
      expect(createCustomerContact).toHaveBeenCalledWith({
        customerId: 'customer_1',
        name: 'Jane Doe',
        role: 'Manager',
        phone: '555-1234',
        email: 'jane@acme.com'
      })
    })

    it('blank role/phone/email are submitted as empty strings, normalized to null server-side', async () => {
      const createCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact() })
      installMockApi({ createCustomerContact })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add contact' }))
      fireEvent.change(document.getElementById('contact-name') as HTMLInputElement, {
        target: { value: 'Jane Doe' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

      await waitFor(() => expect(createCustomerContact).toHaveBeenCalledTimes(1))
      const callArg = createCustomerContact.mock.calls[0][0]
      expect(callArg.role).toBe('')
      expect(callArg.phone).toBe('')
      expect(callArg.email).toBe('')
    })

    it('updates an existing contact', async () => {
      const updateCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact({ name: 'Jane Smith' }) })
      installMockApi({
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] }),
        updateCustomerContact
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Jane Doe')
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.change(document.getElementById('contact-name') as HTMLInputElement, {
        target: { value: 'Jane Smith' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))

      await waitFor(() => expect(updateCustomerContact).toHaveBeenCalledTimes(1))
      expect(updateCustomerContact.mock.calls[0][0]).toEqual({
        contactId: 'contact_1',
        name: 'Jane Smith',
        role: '',
        phone: '',
        email: ''
      })
    })

    it('a contact cannot be moved to another customer -- no customerId field is ever submitted on update', async () => {
      const updateCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact() })
      installMockApi({
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] }),
        updateCustomerContact
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Jane Doe')
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
      fireEvent.click(screen.getByRole('button', { name: 'Save contact' }))

      await waitFor(() => expect(updateCustomerContact).toHaveBeenCalledTimes(1))
      expect(updateCustomerContact.mock.calls[0][0]).not.toHaveProperty('customerId')
    })

    it('deactivates a contact', async () => {
      const deactivateCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact({ isActive: false }) })
      installMockApi({
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] }),
        deactivateCustomerContact
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Jane Doe')
      fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }))
      await waitFor(() =>
        expect(deactivateCustomerContact).toHaveBeenCalledWith({ contactId: 'contact_1' })
      )
    })

    it('reactivates a contact', async () => {
      const reactivateCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: true, contact: makeContact({ isActive: true }) })
      installMockApi({
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact({ isActive: false })] }),
        reactivateCustomerContact
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Jane Doe')
      fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }))
      await waitFor(() =>
        expect(reactivateCustomerContact).toHaveBeenCalledWith({ contactId: 'contact_1' })
      )
    })

    it('there is no delete or remove control for a contact anywhere on this screen', async () => {
      installMockApi({
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )
      await screen.findByText('Jane Doe')
      expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
      expect(screen.queryByRole('button', { name: /remove/i })).toBeNull()
    })

    it('inactive parent customer hides all contact mutation controls, but contacts remain visible (readable)', async () => {
      installMockApi({
        getCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: false }) }),
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] })
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      expect(await screen.findByText('Jane Doe')).toBeDefined()
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Deactivate' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Reactivate' })).toBeNull()
    })

    it('parent reactivation restores contact mutation controls', async () => {
      const reactivateCustomer = vi
        .fn()
        .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: true }) })
      installMockApi({
        getCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, customer: makeCustomer({ isActive: false }) }),
        listContactsForCustomer: vi
          .fn()
          .mockResolvedValue({ success: true, contacts: [makeContact()] }),
        reactivateCustomer
      })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      await screen.findByText('Jane Doe')
      expect(screen.queryByRole('button', { name: 'Add contact' })).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: 'Reactivate customer' }))
      await waitFor(() => expect(reactivateCustomer).toHaveBeenCalledTimes(1))
      expect(await screen.findByRole('button', { name: 'Add contact' })).toBeDefined()
    })

    it('a failed contact save shows a safe error message', async () => {
      const createCustomerContact = vi
        .fn()
        .mockResolvedValue({ success: false, errorCode: 'unexpected_error' })
      installMockApi({ createCustomerContact })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add contact' }))
      fireEvent.change(document.getElementById('contact-name') as HTMLInputElement, {
        target: { value: 'Jane Doe' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Add contact' }))

      expect(await screen.findByText('Something went wrong. Try again.')).toBeDefined()
    })

    it('prevents double submission of the contact form: rapid repeated clicks produce exactly one IPC call', async () => {
      let resolveCreate: (value: unknown) => void = () => {}
      const createCustomerContact = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveCreate = resolve
        })
      )
      installMockApi({ createCustomerContact })
      render(
        <CustomerDetailScreen
          customerId="customer_1"
          canManageCustomers
          onBack={noop}
          onSaved={noop}
        />
      )

      fireEvent.click(await screen.findByRole('button', { name: 'Add contact' }))
      fireEvent.change(document.getElementById('contact-name') as HTMLInputElement, {
        target: { value: 'Jane Doe' }
      })
      const button = screen.getByRole('button', { name: 'Add contact' })
      fireEvent.click(button)
      fireEvent.click(button)
      fireEvent.click(button)

      expect(createCustomerContact).toHaveBeenCalledTimes(1)
      resolveCreate({ success: true, contact: makeContact() })
    })
  })
})

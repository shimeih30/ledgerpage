// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetupWizard } from '../../src/renderer/src/setup/SetupWizard'
import type {
  CompleteSetupInput,
  CompleteSetupResult,
  ConfirmRecoveryKeyInput,
  ConfirmRecoveryKeyResult,
  FirstRunStatus,
  PrepareRecoveryKeyResult
} from '../../src/shared/ipc/setup'

afterEach(() => {
  cleanup()
})

const PLAINTEXT_KEY = 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567'

interface MockApiOverrides {
  prepareRecoveryKey?: () => Promise<PrepareRecoveryKeyResult>
  confirmRecoveryKey?: (input: ConfirmRecoveryKeyInput) => Promise<ConfirmRecoveryKeyResult>
  completeSetup?: (input: CompleteSetupInput) => Promise<CompleteSetupResult>
}

function installMockApi(overrides: MockApiOverrides = {}) {
  let prepareCallCount = 0
  const prepareRecoveryKey =
    overrides.prepareRecoveryKey ??
    vi.fn<() => Promise<PrepareRecoveryKeyResult>>().mockImplementation(() => {
      prepareCallCount += 1
      return Promise.resolve({
        success: true,
        ceremonyToken: `tok-${String(prepareCallCount)}`,
        plaintextRecoveryKey: prepareCallCount === 1 ? PLAINTEXT_KEY : 'NEW1-KEY2-VALU-E345'
      })
    })

  const api = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn<() => Promise<FirstRunStatus>>().mockResolvedValue({
      status: 'setup_required'
    }),
    prepareRecoveryKey,
    confirmRecoveryKey:
      overrides.confirmRecoveryKey ??
      vi.fn().mockResolvedValue({ success: true, commitToken: 'commit-token-1' }),
    cancelRecoveryKey: vi.fn().mockResolvedValue(undefined),
    completeSetup: overrides.completeSetup ?? vi.fn().mockResolvedValue({ success: true }),
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
    reactivateCustomerContact: vi.fn()
  }
  window.ledgerpage = api
  return api
}

async function fillCompanyStep(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('Company name'), 'Farmer Ben Sauces')
  await user.type(screen.getByLabelText('Address'), '1 Main St')
  await user.type(screen.getByLabelText('Contact details'), 'ben@example.com')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

async function passCurrencyStep(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  expect(await screen.findByText('Your functional currency')).toBeDefined()
  await user.click(screen.getByRole('button', { name: 'Confirm and continue' }))
}

async function fillOwnerStep(
  user: ReturnType<typeof userEvent.setup>,
  overrides: { password?: string; passwordConfirmation?: string } = {}
): Promise<void> {
  expect(await screen.findByText('Create the Owner account')).toBeDefined()
  await user.type(screen.getByLabelText('Your name'), 'Ben')
  await user.type(screen.getByLabelText('Username'), 'ben')
  await user.type(screen.getByLabelText('Password'), overrides.password ?? 'a-strong-password-1')
  await user.type(
    screen.getByLabelText('Confirm password'),
    overrides.passwordConfirmation ?? overrides.password ?? 'a-strong-password-1'
  )
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('SetupWizard', () => {
  describe('the full happy path', () => {
    it('walks through every stage and reaches completion', async () => {
      const api = installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)

      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      expect(screen.getByLabelText('Recovery key').textContent).toBe(PLAINTEXT_KEY)
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Confirm your recovery key')).toBeDefined()
      await user.type(screen.getByLabelText('Recovery key'), PLAINTEXT_KEY)
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(await screen.findByText('You\u2019re all set')).toBeDefined()
      expect(api.completeSetup).toHaveBeenCalledWith({
        company: {
          name: 'Farmer Ben Sauces',
          address: '1 Main St',
          contactDetails: 'ben@example.com'
        },
        owner: {
          displayName: 'Ben',
          loginIdentifier: 'ben',
          password: 'a-strong-password-1',
          passwordConfirmation: 'a-strong-password-1'
        },
        commitToken: 'commit-token-1'
      })
    })
  })

  describe('validation prevents invalid progression', () => {
    it('the company step will not advance with empty fields, and shows inline errors', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Enter your company name.')).toBeDefined()
      expect(screen.queryByText('Your functional currency')).toBeNull()
    })

    it('the owner step will not advance with an empty display name', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      expect(await screen.findByText('Create the Owner account')).toBeDefined()

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      expect(screen.getByText('Enter your name.')).toBeDefined()
    })

    it('the owner step rejects a username containing spaces', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await user.type(screen.getByLabelText('Your name'), 'Ben')
      await user.type(screen.getByLabelText('Username'), 'has spaces')
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.type(screen.getByLabelText('Confirm password'), 'a-strong-password-1')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Usernames cannot contain spaces.')).toBeDefined()
      expect(screen.queryByText('Save your recovery key')).toBeNull()
    })

    it('the owner step rejects a password shorter than the minimum', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await user.type(screen.getByLabelText('Your name'), 'Ben')
      await user.type(screen.getByLabelText('Username'), 'ben')
      await user.type(screen.getByLabelText('Password'), 'short')
      await user.type(screen.getByLabelText('Confirm password'), 'short')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Use at least 8 characters.')).toBeDefined()
    })
  })

  describe('password mismatch', () => {
    it('is shown as an inline error and blocks progression', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      expect(await screen.findByText('Create the Owner account')).toBeDefined()
      await user.type(screen.getByLabelText('Your name'), 'Ben')
      await user.type(screen.getByLabelText('Username'), 'ben')
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.type(screen.getByLabelText('Confirm password'), 'a-different-password-2')
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByText('Passwords don\u2019t match.')).toBeDefined()
      expect(screen.queryByText('Save your recovery key')).toBeNull()
    })
  })

  describe('double submission prevention', () => {
    it('disables the confirm button and shows a busy label while a confirm request is in flight', async () => {
      let resolveConfirm!: (value: ConfirmRecoveryKeyResult) => void
      const pendingConfirm = new Promise<ConfirmRecoveryKeyResult>((resolve) => {
        resolveConfirm = resolve
      })
      installMockApi({ confirmRecoveryKey: () => pendingConfirm })
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Confirm your recovery key')).toBeDefined()
      await user.type(screen.getByLabelText('Recovery key'), PLAINTEXT_KEY)
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      const busyButton = await screen.findByRole('button', { name: 'Confirming\u2026' })
      expect(busyButton.hasAttribute('disabled')).toBe(true)

      resolveConfirm({ success: true, commitToken: 'commit-token-1' })
      await waitFor(() => {
        expect(screen.queryByText('Confirming\u2026')).toBeNull()
      })
    })
  })

  describe('recovery key one-time display', () => {
    it('is displayed on the display step, and is gone from the DOM on the confirm step', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)

      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      expect(screen.getByText(PLAINTEXT_KEY)).toBeDefined()

      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Confirm your recovery key')).toBeDefined()
      expect(screen.queryByText(PLAINTEXT_KEY)).toBeNull()
    })
  })

  describe('acknowledgement and re-entry are required', () => {
    it('the Continue button on the display step is disabled until the checkbox is checked', async () => {
      installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()

      const continueButton = screen.getByRole('button', { name: 'Continue' })
      expect(continueButton.hasAttribute('disabled')).toBe(true)

      await user.click(screen.getByLabelText(/I have saved/))
      expect(continueButton.hasAttribute('disabled')).toBe(false)
    })

    it('a wrong re-entry shows an error and does not proceed to completion', async () => {
      installMockApi({ confirmRecoveryKey: () => Promise.resolve({ success: false }) })
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Confirm your recovery key')).toBeDefined()
      await user.type(screen.getByLabelText('Recovery key'), 'WRONG-KEY-ENTIRELY')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      expect(
        await screen.findByText(
          'That key doesn\u2019t match what you saved. Check it and try again.'
        )
      ).toBeDefined()
      expect(screen.queryByText('You\u2019re all set')).toBeNull()
    })

    it('the error after a wrong re-entry never contains the plaintext key', async () => {
      installMockApi({ confirmRecoveryKey: () => Promise.resolve({ success: false }) })
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await user.type(screen.getByLabelText('Recovery key'), 'WRONG-ENTRY')
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      const errorText = await screen.findByText(/doesn.t match/)
      expect(errorText.textContent).not.toContain(PLAINTEXT_KEY)
    })

    it('"Generate a new key" cancels the old ceremony and shows a fresh key', async () => {
      const api = installMockApi()
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(await screen.findByText('Confirm your recovery key')).toBeDefined()
      await user.click(screen.getByRole('button', { name: 'Generate a new key instead' }))

      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      expect(screen.getByText('NEW1-KEY2-VALU-E345')).toBeDefined()
      expect(api.cancelRecoveryKey).toHaveBeenCalledWith({ ceremonyToken: 'tok-1' })
    })
  })

  describe('errors do not display secrets', () => {
    it('a completeSetup failure shows a safe, generic message with no password or key in it', async () => {
      installMockApi({
        completeSetup: () => Promise.resolve({ success: false, errorCode: 'unexpected_error' })
      })
      const user = userEvent.setup()
      render(<SetupWizard />)

      await fillCompanyStep(user)
      await passCurrencyStep(user)
      await fillOwnerStep(user)
      expect(await screen.findByText('Save your recovery key')).toBeDefined()
      await user.click(screen.getByLabelText(/I have saved/))
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      await user.type(screen.getByLabelText('Recovery key'), PLAINTEXT_KEY)
      await user.click(screen.getByRole('button', { name: 'Confirm' }))

      const errorText = await screen.findByText('Something went wrong completing setup. Try again.')
      expect(errorText.textContent).not.toContain('a-strong-password-1')
      expect(errorText.textContent).not.toContain(PLAINTEXT_KEY)
    })
  })
})

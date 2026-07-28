// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuditLogScreen } from '../../src/renderer/src/audit/AuditLogScreen'
import type { ListAuditEntriesResult, SafeAuditLogEntry } from '../../src/shared/ipc/audit'

afterEach(() => {
  cleanup()
})

function makeEntry(overrides: Partial<SafeAuditLogEntry> = {}): SafeAuditLogEntry {
  return {
    id: 'audit_1',
    entityType: 'tax_code',
    entityId: 'tc_1',
    entityLabel: 'STD',
    action: 'create',
    changedFields: { isActive: { old: null, new: true } },
    actorType: 'system',
    userId: null,
    actorLabel: 'System',
    companyId: 'primary_company',
    occurredAt: new Date('2026-01-01T12:00:00.000Z').getTime(),
    ...overrides
  }
}

function installMockApi(
  listAuditEntries: (input: unknown) => Promise<ListAuditEntriesResult>
): void {
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
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn(),
    listAuditEntries,
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
}

describe('AuditLogScreen', () => {
  it('shows a loading state, then the initial page of entries', async () => {
    installMockApi(() => Promise.resolve({ success: true, entries: [makeEntry()] }))
    render(<AuditLogScreen />)

    expect(screen.getByText('Loading\u2026')).toBeDefined()
    expect(await screen.findByText('STD', { exact: false })).toBeDefined()
  })

  it('shows the actor\u2019s human-readable display name, never the opaque internal user id', async () => {
    const opaqueUserId = 'user_9f3a7c2e-51db-4a11-8f0e-2b6d4e1a7c90'
    installMockApi(() =>
      Promise.resolve({
        success: true,
        entries: [
          makeEntry({
            actorType: 'user',
            userId: opaqueUserId,
            actorLabel: 'Priya Sharma'
          })
        ]
      })
    )
    render(<AuditLogScreen />)

    expect(await screen.findByText('Priya Sharma')).toBeDefined()
    expect(screen.queryByText(opaqueUserId)).toBeNull()
    // The renderer only ever displays whatever the main process already
    // resolved and sent as actorLabel — it has no user-lookup logic of
    // its own, and userId (still present in the result for durable
    // identity) is never rendered as the visible actor text.
  })

  it('shows an empty state when there are no matching entries', async () => {
    installMockApi(() => Promise.resolve({ success: true, entries: [] }))
    render(<AuditLogScreen />)

    expect(await screen.findByText('No audit entries match these filters.')).toBeDefined()
  })

  it('shows an error state on a generic failure', async () => {
    installMockApi(() => Promise.resolve({ success: false, errorCode: 'unexpected_error' }))
    render(<AuditLogScreen />)

    expect(
      await screen.findByText('Couldn\u2019t load the audit log. Try reloading the app.')
    ).toBeDefined()
  })

  it('shows an unauthorized state distinct from a generic error, on not_authorized', async () => {
    installMockApi(() => Promise.resolve({ success: false, errorCode: 'not_authorized' }))
    render(<AuditLogScreen />)

    expect(
      await screen.findByText(
        'You don\u2019t have access to the audit log, or your session is no longer active.'
      )
    ).toBeDefined()
    // Confirms the screen genuinely defers to whatever the main process
    // returns rather than assuming access — being rendered at all does
    // not bypass that independent, authoritative check.
  })

  it('shows an unauthorized state on session_invalid too', async () => {
    installMockApi(() => Promise.resolve({ success: false, errorCode: 'session_invalid' }))
    render(<AuditLogScreen />)

    expect(
      await screen.findByText(
        'You don\u2019t have access to the audit log, or your session is no longer active.'
      )
    ).toBeDefined()
  })

  it('clearly displays [REDACTED] for a redacted field value', async () => {
    installMockApi(() =>
      Promise.resolve({
        success: true,
        entries: [makeEntry({ changedFields: { passwordHash: { old: null, new: '[redacted]' } } })]
      })
    )
    render(<AuditLogScreen />)

    expect(await screen.findByText(/\[REDACTED\]/)).toBeDefined()
  })

  it('does not execute or render raw HTML from a changed-field value', async () => {
    const maliciousValue = '<img src=x onerror="window.__pwned = true">'
    installMockApi(() =>
      Promise.resolve({
        success: true,
        entries: [makeEntry({ changedFields: { entityLabel: { old: null, new: maliciousValue } } })]
      })
    )
    render(<AuditLogScreen />)

    await screen.findByText('STD', { exact: false })
    // The literal markup text appears as plain text content (React
    // escapes it by default; this component uses no
    // dangerouslySetInnerHTML anywhere) — it was never parsed as an
    // actual <img> element, so the onerror handler never had anything
    // to attach to or fire from.
    expect(document.querySelectorAll('img').length).toBe(0)
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined()
  })

  it('passes the selected entity-type filter through to listAuditEntries on Apply', async () => {
    const listAuditEntries = vi.fn().mockResolvedValue({ success: true, entries: [] })
    installMockApi(listAuditEntries)
    const user = userEvent.setup()
    render(<AuditLogScreen />)
    await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(1))

    await user.selectOptions(screen.getByLabelText('Entity type'), 'user')
    await user.click(screen.getByRole('button', { name: 'Apply filters' }))

    await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(2))
    expect(listAuditEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ entityType: 'user' })
    )
  })

  describe('Load More', () => {
    it('appends new entries rather than replacing the existing list', async () => {
      const listAuditEntries = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          entries: [makeEntry({ id: 'audit_1', entityId: 'tc_1', entityLabel: 'FIRST' })],
          nextCursor: { occurredAt: 1000, id: 'audit_1' }
        })
        .mockResolvedValueOnce({
          success: true,
          entries: [makeEntry({ id: 'audit_2', entityId: 'tc_2', entityLabel: 'SECOND' })]
        })
      installMockApi(listAuditEntries)
      const user = userEvent.setup()
      render(<AuditLogScreen />)

      expect(await screen.findByText('FIRST', { exact: false })).toBeDefined()
      await user.click(screen.getByRole('button', { name: 'Load more' }))

      expect(await screen.findByText('SECOND', { exact: false })).toBeDefined()
      expect(screen.getByText('FIRST', { exact: false })).toBeDefined()
    })

    it('passes the returned cursor to the next request', async () => {
      const cursor = { occurredAt: 12345, id: 'audit_1' }
      const listAuditEntries = vi
        .fn()
        .mockResolvedValueOnce({ success: true, entries: [makeEntry()], nextCursor: cursor })
        .mockResolvedValueOnce({ success: true, entries: [] })
      installMockApi(listAuditEntries)
      const user = userEvent.setup()
      render(<AuditLogScreen />)

      await screen.findByText('STD', { exact: false })
      await user.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(2))
      expect(listAuditEntries).toHaveBeenLastCalledWith(expect.objectContaining({ cursor }))
    })

    it('prevents duplicate Load More requests while one is already in flight', async () => {
      let resolveSecondCall!: (value: ListAuditEntriesResult) => void
      const secondCallPromise = new Promise<ListAuditEntriesResult>((resolve) => {
        resolveSecondCall = resolve
      })
      const listAuditEntries = vi
        .fn()
        .mockResolvedValueOnce({
          success: true,
          entries: [makeEntry()],
          nextCursor: { occurredAt: 1, id: 'audit_1' }
        })
        .mockImplementationOnce(() => secondCallPromise)
      installMockApi(listAuditEntries)
      const user = userEvent.setup()
      render(<AuditLogScreen />)

      await screen.findByText('STD', { exact: false })
      const loadMoreButton = screen.getByRole('button', { name: 'Load more' })

      await user.click(loadMoreButton)
      // Button is now disabled and shows a busy label while in flight —
      // a second click while still pending must not issue a second
      // request.
      await user.click(screen.getByRole('button', { name: 'Loading\u2026' }))

      expect(listAuditEntries).toHaveBeenCalledTimes(2) // 1 initial + 1 load-more, never 3

      resolveSecondCall({ success: true, entries: [] })
    })

    it('hides the Load More button once nextCursor is absent', async () => {
      installMockApi(() => Promise.resolve({ success: true, entries: [makeEntry()] }))
      render(<AuditLogScreen />)

      await screen.findByText('STD', { exact: false })
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull()
    })
  })

  describe('local-calendar date filters', () => {
    const originalTz = process.env.TZ

    afterEach(() => {
      if (originalTz === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTz
      }
    })

    /**
     * A deliberately varied mix: UTC itself, a negative whole-hour
     * offset, a positive whole-hour offset, and a positive
     * fractional-hour offset — chosen so the same test proves
     * correctness across the specific kinds of offsets that would
     * expose a UTC-vs-local mistake, rather than trusting whatever
     * timezone the test happens to run under by default. Node.js reads
     * process.env.TZ live (confirmed directly before relying on this),
     * so each case genuinely changes the runtime's local timezone.
     */
    const testTimezones = [
      'UTC',
      'America/Los_Angeles',
      'Pacific/Kiritimati',
      'Asia/Kolkata'
    ] as const

    it.each(testTimezones)(
      'computes local start/end-of-day boundaries correctly under %s, never shifting into an adjacent local day',
      async (timezone) => {
        process.env.TZ = timezone

        const listAuditEntries = vi.fn().mockResolvedValue({ success: true, entries: [] })
        installMockApi(listAuditEntries)
        render(<AuditLogScreen />)
        await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(1))

        fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-15' } })
        fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-20' } })
        fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

        await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(2))
        const lastCallInput = listAuditEntries.mock.calls[
          listAuditEntries.mock.calls.length - 1
        ][0] as { fromOccurredAt?: number; toOccurredAt?: number }

        // The expected value is computed the same way the component
        // itself must compute it — via the local (multi-argument) Date
        // constructor, never an ISO string with a Z suffix — so this
        // comparison is meaningful in whatever timezone `timezone` sets,
        // not hardcoded to one specific offset.
        expect(lastCallInput.fromOccurredAt).toBe(new Date(2026, 0, 15, 0, 0, 0, 0).getTime())
        expect(lastCallInput.toOccurredAt).toBe(new Date(2026, 0, 20, 23, 59, 59, 999).getTime())

        // Converting the computed timestamp back via LOCAL date
        // accessors must yield exactly the calendar day that was
        // selected — the direct proof that no adjacent-day shift
        // occurred, regardless of which timezone this iteration set.
        const fromAsLocalDate = new Date(lastCallInput.fromOccurredAt as number)
        expect(fromAsLocalDate.getFullYear()).toBe(2026)
        expect(fromAsLocalDate.getMonth()).toBe(0)
        expect(fromAsLocalDate.getDate()).toBe(15)
        expect(fromAsLocalDate.getHours()).toBe(0)
        expect(fromAsLocalDate.getMinutes()).toBe(0)
        expect(fromAsLocalDate.getSeconds()).toBe(0)
        expect(fromAsLocalDate.getMilliseconds()).toBe(0)

        const toAsLocalDate = new Date(lastCallInput.toOccurredAt as number)
        expect(toAsLocalDate.getFullYear()).toBe(2026)
        expect(toAsLocalDate.getMonth()).toBe(0)
        expect(toAsLocalDate.getDate()).toBe(20)
        expect(toAsLocalDate.getHours()).toBe(23)
        expect(toAsLocalDate.getMinutes()).toBe(59)
        expect(toAsLocalDate.getSeconds()).toBe(59)
        expect(toAsLocalDate.getMilliseconds()).toBe(999)
      }
    )

    it('an inverted range (From after To) makes no IPC request and shows a visible range-error message', async () => {
      const listAuditEntries = vi.fn().mockResolvedValue({ success: true, entries: [] })
      installMockApi(listAuditEntries)
      render(<AuditLogScreen />)
      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(1))

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-20' } })
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-15' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

      // A visible validation message is rendered.
      expect(await screen.findByText('The From date must not be after the To date.')).toBeDefined()
      // No IPC request was made for the invalid attempt -- still
      // exactly the one call from the initial mount.
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(listAuditEntries).toHaveBeenCalledTimes(1)

      // The user's typed values are preserved, not cleared, so they
      // can correct them.
      expect((screen.getByLabelText('From') as HTMLInputElement).value).toBe('2026-01-20')
      expect((screen.getByLabelText('To') as HTMLInputElement).value).toBe('2026-01-15')
    })

    it('correcting an inverted range permits the request and clears the validation error', async () => {
      const listAuditEntries = vi.fn().mockResolvedValue({ success: true, entries: [] })
      installMockApi(listAuditEntries)
      render(<AuditLogScreen />)
      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(1))

      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-20' } })
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-15' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
      await screen.findByText('The From date must not be after the To date.')

      // Correct the range so From is no longer after To.
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-25' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))

      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(2))
      expect(listAuditEntries).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromOccurredAt: new Date(2026, 0, 20, 0, 0, 0, 0).getTime(),
          toOccurredAt: new Date(2026, 0, 25, 23, 59, 59, 999).getTime()
        })
      )
      // The validation error is cleared once valid filters are
      // successfully applied.
      expect(screen.queryByText('The From date must not be after the To date.')).toBeNull()
    })

    it('Load More uses only the last successfully applied filters, never unsubmitted or currently invalid form values', async () => {
      const listAuditEntries = vi
        .fn()
        .mockResolvedValueOnce({ success: true, entries: [] }) // initial mount
        .mockResolvedValueOnce({
          success: true,
          entries: [makeEntry({ id: 'audit_1', entityId: 'tc_1', entityLabel: 'FIRST' })],
          nextCursor: { occurredAt: 1000, id: 'audit_1' }
        }) // Apply filters with a valid range
        .mockResolvedValueOnce({
          success: true,
          entries: [makeEntry({ id: 'audit_2', entityId: 'tc_2', entityLabel: 'SECOND' })]
        }) // Load More
      installMockApi(listAuditEntries)
      render(<AuditLogScreen />)
      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(1))

      // Apply a valid range successfully.
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } })
      fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-01-31' } })
      fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }))
      await screen.findByText('FIRST', { exact: false })

      // Now edit the form into an inverted (currently invalid) range,
      // WITHOUT clicking Apply filters again -- this must have no
      // effect on what Load More sends.
      fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-06-01' } })

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

      await waitFor(() => expect(listAuditEntries).toHaveBeenCalledTimes(3))
      expect(listAuditEntries).toHaveBeenLastCalledWith({
        fromOccurredAt: new Date(2026, 0, 1, 0, 0, 0, 0).getTime(),
        toOccurredAt: new Date(2026, 0, 31, 23, 59, 59, 999).getTime(),
        cursor: { occurredAt: 1000, id: 'audit_1' }
      })
    })
  })
})

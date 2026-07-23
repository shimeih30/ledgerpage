// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthenticatedApp } from '../../src/renderer/src/auth/AuthenticatedApp'
import type { LoginResult, SessionState, UnlockResult } from '../../src/shared/ipc/login'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function installMockApi(overrides: {
  getSessionState?: () => Promise<SessionState>
  login?: () => Promise<LoginResult>
  unlockSession?: () => Promise<UnlockResult>
  logout?: () => Promise<void>
  touchSession?: () => Promise<void>
}): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: overrides.login ?? vi.fn(),
    getSessionState:
      overrides.getSessionState ?? vi.fn().mockResolvedValue({ state: 'logged_out' }),
    unlockSession: overrides.unlockSession ?? vi.fn(),
    logout: overrides.logout ?? vi.fn().mockResolvedValue(undefined),
    touchSession: overrides.touchSession ?? vi.fn().mockResolvedValue(undefined),
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
    listAssignableTaxCodes: vi.fn().mockResolvedValue({ success: true, taxCodes: [] })
  }
}

describe('AuthenticatedApp', () => {
  it('shows a loading state before the initial session-state check resolves', () => {
    installMockApi({ getSessionState: () => new Promise(() => {}) })
    render(<AuthenticatedApp />)
    expect(screen.getByText('Loading…')).toBeDefined()
  })

  it('logged_out renders LoginScreen', async () => {
    installMockApi({ getSessionState: () => Promise.resolve({ state: 'logged_out' }) })
    render(<AuthenticatedApp />)
    expect(await screen.findByText('Sign in to LedgerPage')).toBeDefined()
  })

  it('locked renders LockScreen with the correct display name', async () => {
    installMockApi({
      getSessionState: () => Promise.resolve({ state: 'locked', displayName: 'Ben' })
    })
    render(<AuthenticatedApp />)
    expect(await screen.findByText('Welcome back, Ben')).toBeDefined()
  })

  it('active renders the authenticated shell', async () => {
    installMockApi({
      getSessionState: () =>
        Promise.resolve({
          state: 'active',
          displayName: 'Ben',
          isOwner: true,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: true
        })
    })
    render(<AuthenticatedApp />)
    expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()
    expect(screen.getByText('Ben')).toBeDefined()
  })

  it('a failed session-state check fails closed to logged_out, not stuck loading', async () => {
    installMockApi({ getSessionState: () => Promise.reject(new Error('IPC failure')) })
    render(<AuthenticatedApp />)
    expect(await screen.findByText('Sign in to LedgerPage')).toBeDefined()
  })

  describe('main-process idle locks become visible via polling', () => {
    it('the session-state poll picks up a lock the main process triggered autonomously, with no user action', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const getSessionState = vi
        .fn<() => Promise<SessionState>>()
        .mockResolvedValueOnce({
          state: 'active',
          displayName: 'Ben',
          isOwner: true,
          canViewAuditLog: true,
          canViewProducts: true,
          canManageProducts: true
        })
        .mockResolvedValue({ state: 'locked', displayName: 'Ben' })
      installMockApi({ getSessionState })

      render(<AuthenticatedApp />)
      await vi.waitFor(() =>
        expect(screen.queryByText('Slice 1 — application shell')).not.toBeNull()
      )

      // Advance past the polling interval — no click, no key press, no
      // explicit unlock call anywhere in this test — the only thing
      // that changes the screen is the next poll picking up the new
      // state the (mocked) main process now reports.
      await vi.advanceTimersByTimeAsync(6000)

      await vi.waitFor(() => expect(screen.queryByText('Welcome back, Ben')).not.toBeNull())
      expect(getSessionState.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    it('getSessionState (the poll) never itself calls touchSession', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const touchSession = vi.fn().mockResolvedValue(undefined)
      installMockApi({
        getSessionState: () =>
          Promise.resolve({
            state: 'active',
            displayName: 'Ben',
            isOwner: true,
            canViewAuditLog: true,
            canViewProducts: true,
            canManageProducts: true
          }),
        touchSession
      })

      render(<AuthenticatedApp />)
      await vi.waitFor(() =>
        expect(screen.queryByText('Slice 1 — application shell')).not.toBeNull()
      )

      await vi.advanceTimersByTimeAsync(20000)

      expect(touchSession).not.toHaveBeenCalled()
    })
  })

  describe('transitions', () => {
    it('LoginScreen -> active shell after a successful login', async () => {
      installMockApi({
        getSessionState: () => Promise.resolve({ state: 'logged_out' }),
        login: vi.fn().mockResolvedValue({
          success: true,
          session: {
            displayName: 'Ben',
            isOwner: true,
            canViewAuditLog: true,
            canViewProducts: true,
            canManageProducts: true
          }
        })
      })
      render(<AuthenticatedApp />)
      expect(await screen.findByText('Sign in to LedgerPage')).toBeDefined()

      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Username'), 'ben')
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()
    })

    it('LockScreen -> active shell after a successful unlock', async () => {
      installMockApi({
        getSessionState: () => Promise.resolve({ state: 'locked', displayName: 'Ben' }),
        unlockSession: vi.fn().mockResolvedValue({
          success: true,
          session: {
            displayName: 'Ben',
            isOwner: true,
            canViewAuditLog: true,
            canViewProducts: true,
            canManageProducts: true
          }
        })
      })
      render(<AuthenticatedApp />)
      expect(await screen.findByText('Welcome back, Ben')).toBeDefined()

      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
      await user.click(screen.getByRole('button', { name: 'Unlock' }))

      expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()
    })

    it('AuthenticatedShell logout -> back to LoginScreen', async () => {
      installMockApi({
        getSessionState: () =>
          Promise.resolve({
            state: 'active',
            displayName: 'Ben',
            isOwner: true,
            canViewAuditLog: true,
            canViewProducts: true,
            canManageProducts: true
          })
      })
      render(<AuthenticatedApp />)
      expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()

      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Log out' }))

      expect(await screen.findByText('Sign in to LedgerPage')).toBeDefined()
    })
  })
})

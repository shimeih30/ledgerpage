// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import type { FirstRunStatus } from '../../src/shared/ipc/setup'
import type { SessionState } from '../../src/shared/ipc/login'

// testing-library's automatic afterEach cleanup relies on vitest's
// global test APIs, which this codebase deliberately does not enable
// (every test file explicitly imports describe/it/expect, matching
// the established convention across the whole suite) — so cleanup
// must be registered explicitly here, or DOM content from an earlier
// test in this file leaks into and corrupts the next one's assertions.
afterEach(() => {
  cleanup()
})

function installMockApi(
  getFirstRunStatus: () => Promise<FirstRunStatus>,
  getSessionState: () => Promise<SessionState> = () => Promise.resolve({ state: 'logged_out' })
): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus,
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState,
    unlockSession: vi.fn(),
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn()
  }
}

describe('App', () => {
  it('setup_required renders the setup wizard, not the authenticated app', async () => {
    installMockApi(() => Promise.resolve({ status: 'setup_required' }))
    render(<App />)

    expect(await screen.findByText('Tell us about your company')).toBeDefined()
    expect(screen.queryByText('Sign in to LedgerPage')).toBeNull()
  })

  it('setup_complete with no active session renders AuthenticatedApp, which shows the login screen', async () => {
    installMockApi(
      () => Promise.resolve({ status: 'setup_complete' }),
      () => Promise.resolve({ state: 'logged_out' })
    )
    render(<App />)

    expect(await screen.findByText('Sign in to LedgerPage')).toBeDefined()
    expect(screen.queryByText('Tell us about your company')).toBeNull()
  })

  it('setup_complete with a locked session renders the lock screen, not the login screen', async () => {
    installMockApi(
      () => Promise.resolve({ status: 'setup_complete' }),
      () => Promise.resolve({ state: 'locked', displayName: 'Ben' })
    )
    render(<App />)

    expect(await screen.findByText('Welcome back, Ben')).toBeDefined()
    expect(screen.queryByText('Sign in to LedgerPage')).toBeNull()
  })

  it('setup_complete with an active session renders the authenticated shell', async () => {
    installMockApi(
      () => Promise.resolve({ status: 'setup_complete' }),
      () => Promise.resolve({ state: 'active', displayName: 'Ben', isOwner: true })
    )
    render(<App />)

    expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()
    expect(screen.queryByText('Sign in to LedgerPage')).toBeNull()
  })

  it('inconsistent_state renders the safe, generic screen — never the wizard or the authenticated app', async () => {
    installMockApi(() => Promise.resolve({ status: 'inconsistent_state' }))
    render(<App />)

    expect(await screen.findByText('Setup could not be verified')).toBeDefined()
    expect(screen.queryByText('Tell us about your company')).toBeNull()
    expect(screen.queryByText('Sign in to LedgerPage')).toBeNull()
  })

  it('a failed status check (IPC throws) is treated the same as inconsistent_state — fails closed', async () => {
    installMockApi(() => Promise.reject(new Error('IPC failure')))
    render(<App />)

    expect(await screen.findByText('Setup could not be verified')).toBeDefined()
  })

  it('shows a loading state before the status check resolves', () => {
    installMockApi(() => new Promise(() => {})) // never resolves
    render(<App />)

    expect(screen.getByText('Loading…')).toBeDefined()
  })
})

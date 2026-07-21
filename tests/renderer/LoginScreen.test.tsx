// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen } from '../../src/renderer/src/auth/LoginScreen'
import type { LoginResult } from '../../src/shared/ipc/login'

afterEach(() => {
  cleanup()
})

function installMockApi(login: () => Promise<LoginResult>): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login,
    getSessionState: vi.fn(),
    unlockSession: vi.fn(),
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn(),
    listAuditEntries: vi.fn()
  }
}

describe('LoginScreen', () => {
  it('calls onLoggedIn with the session on success', async () => {
    installMockApi(() =>
      Promise.resolve({
        success: true,
        session: { displayName: 'Ben', isOwner: true, canViewAuditLog: true }
      })
    )
    const onLoggedIn = vi.fn()
    const user = userEvent.setup()
    render(<LoginScreen onLoggedIn={onLoggedIn} />)

    await user.type(screen.getByLabelText('Username'), 'ben')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(onLoggedIn).toHaveBeenCalledWith({
      displayName: 'Ben',
      isOwner: true,
      canViewAuditLog: true
    })
  })

  it('shows a generic error on failure — never distinguishing wrong username from wrong password', async () => {
    installMockApi(() => Promise.resolve({ success: false }))
    const user = userEvent.setup()
    render(<LoginScreen onLoggedIn={vi.fn()} />)

    await user.type(screen.getByLabelText('Username'), 'ben')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('That username or password isn\u2019t right.')).toBeDefined()
  })

  it('does not submit with an empty username or password', async () => {
    const login = vi.fn().mockResolvedValue({
      success: true,
      session: { displayName: 'Ben', isOwner: true, canViewAuditLog: true }
    })
    installMockApi(login)
    const user = userEvent.setup()
    render(<LoginScreen onLoggedIn={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(login).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Username'), 'ben')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(login).not.toHaveBeenCalled()
  })

  it('disables the submit button and shows a busy label while the request is in flight', async () => {
    let resolveLogin!: (value: LoginResult) => void
    const pending = new Promise<LoginResult>((resolve) => {
      resolveLogin = resolve
    })
    installMockApi(() => pending)
    const user = userEvent.setup()
    render(<LoginScreen onLoggedIn={vi.fn()} />)

    await user.type(screen.getByLabelText('Username'), 'ben')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const busyButton = await screen.findByRole('button', { name: 'Signing in\u2026' })
    expect(busyButton.hasAttribute('disabled')).toBe(true)

    resolveLogin({
      success: true,
      session: { displayName: 'Ben', isOwner: true, canViewAuditLog: true }
    })
  })

  it('a thrown IPC error shows a safe, generic message', async () => {
    installMockApi(() => Promise.reject(new Error('IPC failure')))
    const user = userEvent.setup()
    render(<LoginScreen onLoggedIn={vi.fn()} />)

    await user.type(screen.getByLabelText('Username'), 'ben')
    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByText('Something went wrong signing you in. Try again.')).toBeDefined()
  })
})

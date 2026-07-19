// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LockScreen } from '../../src/renderer/src/auth/LockScreen'
import type { UnlockResult } from '../../src/shared/ipc/login'

afterEach(() => {
  cleanup()
})

function installMockApi(unlockSession: () => Promise<UnlockResult>): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus: vi.fn(),
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn(),
    login: vi.fn(),
    getSessionState: vi.fn(),
    unlockSession,
    logout: vi.fn(),
    touchSession: vi.fn(),
    listUsers: vi.fn(),
    createUser: vi.fn(),
    deactivateUser: vi.fn(),
    reactivateUser: vi.fn(),
    listAssignableRoles: vi.fn()
  }
}

describe('LockScreen', () => {
  it('shows only the signed-in user\u2019s name — never a username field', () => {
    installMockApi(vi.fn())
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    expect(screen.getByText('Welcome back, Ben')).toBeDefined()
    expect(screen.queryByLabelText('Username')).toBeNull()
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  it('calls onUnlocked with the session on a correct password', async () => {
    installMockApi(() =>
      Promise.resolve({ success: true, session: { displayName: 'Ben', isOwner: true } })
    )
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(onUnlocked).toHaveBeenCalledWith({ displayName: 'Ben', isOwner: true })
  })

  it('a wrong password shows an inline error, clears the field, and allows retry', async () => {
    const unlockSession = vi
      .fn()
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, session: { displayName: 'Ben', isOwner: true } })
    installMockApi(unlockSession)
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('That password isn\u2019t right. Try again.')).toBeDefined()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(onUnlocked).toHaveBeenCalledWith({ displayName: 'Ben', isOwner: true })
  })

  it('disables the submit button while the request is in flight', async () => {
    let resolveUnlock!: (value: UnlockResult) => void
    const pending = new Promise<UnlockResult>((resolve) => {
      resolveUnlock = resolve
    })
    installMockApi(() => pending)
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    const busyButton = await screen.findByRole('button', { name: 'Unlocking\u2026' })
    expect(busyButton.hasAttribute('disabled')).toBe(true)

    resolveUnlock({ success: true, session: { displayName: 'Ben', isOwner: true } })
  })

  it('a thrown IPC error shows a safe, generic message', async () => {
    installMockApi(() => Promise.reject(new Error('IPC failure')))
    const user = userEvent.setup()
    render(<LockScreen displayName="Ben" onUnlocked={vi.fn()} />)

    await user.type(screen.getByLabelText('Password'), 'a-strong-password-1')
    await user.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByText('Something went wrong unlocking. Try again.')).toBeDefined()
  })
})

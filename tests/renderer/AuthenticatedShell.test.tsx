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
    listAuditEntries: vi.fn().mockResolvedValue({ success: true, entries: [] })
  }
}

function session(overrides: Partial<SafeSessionInfo>): SafeSessionInfo {
  return { displayName: 'Ben', isOwner: false, canViewAuditLog: false, ...overrides }
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
})

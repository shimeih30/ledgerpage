// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import App from '../../src/renderer/src/App'
import type { FirstRunStatus } from '../../src/shared/ipc/setup'

// testing-library's automatic afterEach cleanup relies on vitest's
// global test APIs, which this codebase deliberately does not enable
// (every test file explicitly imports describe/it/expect, matching
// the established convention across the whole suite) — so cleanup
// must be registered explicitly here, or DOM content from an earlier
// test in this file leaks into and corrupts the next one's assertions.
afterEach(() => {
  cleanup()
})

function installMockApi(getFirstRunStatus: () => Promise<FirstRunStatus>): void {
  window.ledgerpage = {
    getAppInfo: vi.fn(),
    getFirstRunStatus,
    prepareRecoveryKey: vi.fn(),
    confirmRecoveryKey: vi.fn(),
    cancelRecoveryKey: vi.fn(),
    completeSetup: vi.fn()
  }
}

describe('App', () => {
  it('setup_required renders the setup wizard, not the Slice 1 shell', async () => {
    installMockApi(() => Promise.resolve({ status: 'setup_required' }))
    render(<App />)

    expect(await screen.findByText('Tell us about your company')).toBeDefined()
    expect(screen.queryByText('Slice 1 — application shell')).toBeNull()
  })

  it('setup_complete renders the existing shell, and never the wizard', async () => {
    installMockApi(() => Promise.resolve({ status: 'setup_complete' }))
    render(<App />)

    expect(await screen.findByText('Slice 1 — application shell')).toBeDefined()
    expect(screen.queryByText('Tell us about your company')).toBeNull()
  })

  it('inconsistent_state renders the safe, generic screen — never the wizard or the shell', async () => {
    installMockApi(() => Promise.resolve({ status: 'inconsistent_state' }))
    render(<App />)

    expect(await screen.findByText('Setup could not be verified')).toBeDefined()
    expect(screen.queryByText('Tell us about your company')).toBeNull()
    expect(screen.queryByText('Slice 1 — application shell')).toBeNull()
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

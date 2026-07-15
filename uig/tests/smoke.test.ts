import { describe, expect, it } from 'vitest'

describe('Slice 1 — tooling smoke test', () => {
  it('confirms the test runner executes TypeScript correctly', () => {
    const appName: string = 'LedgerPage'
    expect(appName).toBe('LedgerPage')
  })
})

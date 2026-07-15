import { describe, expect, it } from 'vitest'
import { isApprovedIpcSender } from '../../src/main/security/senderValidation'

describe('isApprovedIpcSender', () => {
  const productionContext = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }
  const devContext = { devServerOrigin: 'http://localhost:5173' }

  it('approves a sender from the exact production renderer file', () => {
    const event = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }
    expect(isApprovedIpcSender(event, productionContext)).toBe(true)
  })

  it('approves a sender from the dev server origin', () => {
    const event = { senderFrame: { url: 'http://localhost:5173/' } }
    expect(isApprovedIpcSender(event, devContext)).toBe(true)
  })

  it('rejects a sender from an external https page', () => {
    const event = { senderFrame: { url: 'https://example.com' } }
    expect(isApprovedIpcSender(event, productionContext)).toBe(false)
  })

  it('rejects a sender from an arbitrary file path', () => {
    const event = { senderFrame: { url: 'file:///etc/passwd' } }
    expect(isApprovedIpcSender(event, productionContext)).toBe(false)
  })

  it('rejects when the sender frame is null (e.g. already destroyed)', () => {
    const event = { senderFrame: null }
    expect(isApprovedIpcSender(event, productionContext)).toBe(false)
  })
})

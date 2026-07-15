import { describe, expect, it, vi } from 'vitest'
import {
  attachWindowSecurity,
  type SecurableWebContents
} from '../../src/main/security/attachWindowSecurity'

function createFakeWebContents() {
  const listeners: Record<string, (event: { preventDefault: () => void }, url: string) => void> = {}

  const fake: SecurableWebContents = {
    on: (event, listener) => {
      listeners[event] = listener
    },
    setWindowOpenHandler: vi.fn()
  }

  return { fake, listeners }
}

describe('attachWindowSecurity', () => {
  const context = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }

  it('blocks navigation the policy disallows', () => {
    const { fake, listeners } = createFakeWebContents()
    attachWindowSecurity(fake, context)

    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'https://example.com')

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('does not block navigation the policy allows', () => {
    const { fake, listeners } = createFakeWebContents()
    attachWindowSecurity(fake, context)

    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'file:///app/out/renderer/index.html#/route')

    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('blocks navigation to a sibling file even under the production policy', () => {
    const { fake, listeners } = createFakeWebContents()
    attachWindowSecurity(fake, context)

    const preventDefault = vi.fn()
    listeners['will-navigate']({ preventDefault }, 'file:///app/out/renderer/other.html')

    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('registers a window-open handler that always denies', () => {
    const { fake } = createFakeWebContents()
    attachWindowSecurity(fake, context)

    const setWindowOpenHandler = fake.setWindowOpenHandler as ReturnType<typeof vi.fn>
    expect(setWindowOpenHandler).toHaveBeenCalledTimes(1)

    const handler = setWindowOpenHandler.mock.calls[0][0]
    expect(handler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(handler({ url: 'file:///app/out/renderer/index.html' })).toEqual({ action: 'deny' })
  })
})

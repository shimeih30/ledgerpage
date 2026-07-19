import { join } from 'node:path'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDatabaseConnection } from '../../src/main/db/connection'
import { runMigrations } from '../../src/main/db/runMigrations'
import { seedReferenceData } from '../../src/main/db/seedReferenceData'
import { seedRoles } from '../../src/main/db/seedRoles'
import type { AppDb } from '../../src/main/db/dbTypes'
import { createTempDir, removeTempDir } from '../helpers/tempDir'

const handle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle }
}))

const context = { productionEntryFileUrl: 'file:///app/out/renderer/index.html' }
const APPROVED_EVENT = { senderFrame: { url: 'file:///app/out/renderer/index.html' } }
const UNAPPROVED_EVENT = { senderFrame: { url: 'https://evil.example.com' } }

const REAL_MIGRATIONS_FOLDER = join(process.cwd(), 'migrations')
const REAL_PASSWORD = 'a-strong-password-1'
const VALID_COMPANY = { name: 'Fixture Co', address: 'Addr', contactDetails: 'c@example.com' }
const VALID_OWNER = {
  displayName: 'Ben',
  loginIdentifier: 'ben',
  password: REAL_PASSWORD,
  passwordConfirmation: REAL_PASSWORD
}

describe('registerSetupHandlers', () => {
  let dir: string
  let rawDb: ReturnType<typeof createDatabaseConnection>
  let db: AppDb

  beforeEach(() => {
    vi.resetModules()
    handle.mockClear()
    dir = createTempDir('ledgerpage-setup-handlers')
    rawDb = createDatabaseConnection(join(dir, 'ledgerpage.db'))
    runMigrations(rawDb, REAL_MIGRATIONS_FOLDER)
    seedReferenceData(rawDb)
    seedRoles(rawDb)
    db = drizzle<Record<string, never>>(rawDb)
  })

  afterEach(() => {
    rawDb.close()
    removeTempDir(dir)
  })

  async function registerAndCapture(): Promise<{
    handlers: Record<string, (event: unknown, input?: unknown) => unknown>
    channels: string[]
  }> {
    const { registerSetupHandlers } = await import('../../src/main/ipc/registerSetupHandlers')
    const { createFirstRunSetupService } = await import('../../src/main/setup/firstRunSetupService')
    const setupService = createFirstRunSetupService()

    registerSetupHandlers({ context, db, setupService })

    const handlers: Record<string, (event: unknown, input?: unknown) => unknown> = {}
    const channels: string[] = []
    for (const call of handle.mock.calls as [
      string,
      (event: unknown, input?: unknown) => unknown
    ][]) {
      handlers[call[0]] = call[1]
      channels.push(call[0])
    }
    return { handlers, channels }
  }

  it('registers exactly the five approved setup channels — nothing more', async () => {
    const { channels } = await registerAndCapture()
    const {
      SETUP_CANCEL_RECOVERY_KEY_CHANNEL,
      SETUP_COMPLETE_CHANNEL,
      SETUP_CONFIRM_RECOVERY_KEY_CHANNEL,
      SETUP_GET_STATUS_CHANNEL,
      SETUP_PREPARE_RECOVERY_KEY_CHANNEL
    } = await import('../../src/shared/ipc/setup')

    expect(channels.sort()).toEqual(
      [
        SETUP_GET_STATUS_CHANNEL,
        SETUP_PREPARE_RECOVERY_KEY_CHANNEL,
        SETUP_CONFIRM_RECOVERY_KEY_CHANNEL,
        SETUP_CANCEL_RECOVERY_KEY_CHANNEL,
        SETUP_COMPLETE_CHANNEL
      ].sort()
    )
  })

  describe('sender validation — every channel rejects an unapproved sender', () => {
    it('setup:get-status', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['setup:get-status'](UNAPPROVED_EVENT)).toThrow()
    })

    it('setup:prepare-recovery-key', async () => {
      const { handlers } = await registerAndCapture()
      await expect(handlers['setup:prepare-recovery-key'](UNAPPROVED_EVENT)).rejects.toThrow()
    })

    it('setup:confirm-recovery-key', async () => {
      const { handlers } = await registerAndCapture()
      await expect(
        handlers['setup:confirm-recovery-key'](UNAPPROVED_EVENT, {
          ceremonyToken: 'x',
          reenteredKey: 'y'
        })
      ).rejects.toThrow()
    })

    it('setup:cancel-recovery-key', async () => {
      const { handlers } = await registerAndCapture()
      expect(() =>
        handlers['setup:cancel-recovery-key'](UNAPPROVED_EVENT, { ceremonyToken: 'x' })
      ).toThrow()
    })

    it('setup:complete', async () => {
      const { handlers } = await registerAndCapture()
      await expect(
        handlers['setup:complete'](UNAPPROVED_EVENT, {
          company: VALID_COMPANY,
          owner: VALID_OWNER,
          commitToken: 'x'
        })
      ).rejects.toThrow()
    })
  })

  describe('setup:get-status', () => {
    it('returns setup_required for a fresh database, with no reason/details field exposed', async () => {
      const { handlers } = await registerAndCapture()
      const result = handlers['setup:get-status'](APPROVED_EVENT)
      expect(result).toEqual({ status: 'setup_required' })
    })

    it('exposes only the fixed inconsistent_state tag, never the internal reason string', async () => {
      // Force an inconsistent state directly (mirrors
      // firstRunStatusService's own test for this scenario: a user
      // exists with no role_owner assignment). users.company_id is
      // itself a foreign key, so a company row must exist first.
      const now = Date.now()
      rawDb
        .prepare(
          "INSERT INTO company (id, name, address, contact_details, currency_id, vat_registered, created_at, updated_at) VALUES ('primary_company', 'Fixture Co', 'Addr', 'c@example.com', 'currency_usd', 0, ?, ?)"
        )
        .run(now, now)
      rawDb
        .prepare(
          "INSERT INTO users (id, company_id, login_identifier, display_name, password_hash, password_changed_at, created_at, updated_at) VALUES ('u1', 'primary_company', 'ben', 'Ben', 'x', 0, 0, 0)"
        )
        .run()

      const { handlers } = await registerAndCapture()
      const result = handlers['setup:get-status'](APPROVED_EVENT) as Record<string, unknown>
      expect(result).toEqual({ status: 'inconsistent_state' })
      expect(Object.keys(result)).toEqual(['status'])
    })
  })

  describe('setup:prepare-recovery-key', () => {
    it('returns a ceremonyToken and plaintextRecoveryKey for an approved sender', async () => {
      const { handlers } = await registerAndCapture()
      const result = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as Record<
        string,
        unknown
      >
      expect(typeof result.ceremonyToken).toBe('string')
      expect(typeof result.plaintextRecoveryKey).toBe('string')
    })

    it('is refused once setup is already complete', async () => {
      const { handlers } = await registerAndCapture()
      const prepared = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as {
        ceremonyToken: string
        plaintextRecoveryKey: string
      }
      const confirmed = (await handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken,
        reenteredKey: prepared.plaintextRecoveryKey
      })) as { success: true; commitToken: string }
      await handlers['setup:complete'](APPROVED_EVENT, {
        company: VALID_COMPANY,
        owner: VALID_OWNER,
        commitToken: confirmed.commitToken
      })

      await expect(handlers['setup:prepare-recovery-key'](APPROVED_EVENT)).rejects.toThrow()
    }, 20000)
  })

  describe('setup:confirm-recovery-key', () => {
    it('rejects malformed input (missing fields) without ever reaching the service', async () => {
      const { handlers } = await registerAndCapture()
      await expect(
        handlers['setup:confirm-recovery-key'](APPROVED_EVENT, { ceremonyToken: 'only-one-field' })
      ).rejects.toThrow()
    })

    it('rejects wrong-typed input (a number instead of a string)', async () => {
      const { handlers } = await registerAndCapture()
      await expect(
        handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
          ceremonyToken: 123,
          reenteredKey: 'y'
        })
      ).rejects.toThrow()
    })

    it('succeeds end to end for a correctly re-entered key', async () => {
      const { handlers } = await registerAndCapture()
      const prepared = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as {
        ceremonyToken: string
        plaintextRecoveryKey: string
      }
      const result = await handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken,
        reenteredKey: prepared.plaintextRecoveryKey
      })
      expect(result).toEqual({ success: true, commitToken: expect.any(String) })
    })
  })

  describe('setup:cancel-recovery-key', () => {
    it('rejects malformed input', async () => {
      const { handlers } = await registerAndCapture()
      expect(() => handlers['setup:cancel-recovery-key'](APPROVED_EVENT, {})).toThrow()
    })

    it('cancelling invalidates the ceremony for later confirmation', async () => {
      const { handlers } = await registerAndCapture()
      const prepared = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as {
        ceremonyToken: string
        plaintextRecoveryKey: string
      }
      handlers['setup:cancel-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken
      })

      const result = await handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken,
        reenteredKey: prepared.plaintextRecoveryKey
      })
      expect(result).toEqual({ success: false })
    })
  })

  describe('setup:complete', () => {
    it('rejects malformed input as invalid_input, without throwing', async () => {
      const { handlers } = await registerAndCapture()
      const result = await handlers['setup:complete'](APPROVED_EVENT, { company: 'not-an-object' })
      expect(result).toEqual({ success: false, errorCode: 'invalid_input' })
    })

    it('succeeds end to end, and no password hash or recovery hash appears anywhere in the result', async () => {
      const { handlers } = await registerAndCapture()
      const prepared = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as {
        ceremonyToken: string
        plaintextRecoveryKey: string
      }
      const confirmed = (await handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken,
        reenteredKey: prepared.plaintextRecoveryKey
      })) as { success: true; commitToken: string }

      const result = await handlers['setup:complete'](APPROVED_EVENT, {
        company: VALID_COMPANY,
        owner: VALID_OWNER,
        commitToken: confirmed.commitToken
      })

      expect(result).toEqual({ success: true })
      const serialized = JSON.stringify(result)
      expect(serialized).not.toMatch(/\$argon2id\$/)
      expect(serialized).not.toContain(REAL_PASSWORD)
      expect(serialized).not.toContain(prepared.plaintextRecoveryKey)
    }, 20000)

    it('a second setup:complete call after success returns the controlled already-complete result', async () => {
      const { handlers } = await registerAndCapture()
      const prepared = (await handlers['setup:prepare-recovery-key'](APPROVED_EVENT)) as {
        ceremonyToken: string
        plaintextRecoveryKey: string
      }
      const confirmed = (await handlers['setup:confirm-recovery-key'](APPROVED_EVENT, {
        ceremonyToken: prepared.ceremonyToken,
        reenteredKey: prepared.plaintextRecoveryKey
      })) as { success: true; commitToken: string }
      await handlers['setup:complete'](APPROVED_EVENT, {
        company: VALID_COMPANY,
        owner: VALID_OWNER,
        commitToken: confirmed.commitToken
      })

      const secondResult = await handlers['setup:complete'](APPROVED_EVENT, {
        company: VALID_COMPANY,
        owner: VALID_OWNER,
        commitToken: confirmed.commitToken
      })
      expect(secondResult).toEqual({ success: false, errorCode: 'setup_already_complete' })
    }, 20000)
  })
})

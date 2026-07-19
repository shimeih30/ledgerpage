import { describe, expect, it } from 'vitest'
import {
  ARGON2ID_PARAMETERS,
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsRehash,
  PasswordHashFormatError,
  PasswordHashValidationError,
  PasswordValidationError,
  validatePasswordHashForStorage,
  verifyPassword
} from '../../../src/main/auth/passwordHashing'

const VALID_PASSWORD = 'correct horse battery staple'

describe('passwordHashing', () => {
  describe('hashPassword', () => {
    it('produces a well-formed Argon2id PHC hash', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      expect(hash.startsWith('$argon2id$')).toBe(true)
    })

    it('embeds the configured parameters in the stored hash', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      expect(hash).toContain(`m=${ARGON2ID_PARAMETERS.memorySize}`)
      expect(hash).toContain(`t=${ARGON2ID_PARAMETERS.iterations}`)
      expect(hash).toContain(`p=${ARGON2ID_PARAMETERS.parallelism}`)
    })

    it('produces a different hash each time for the same password (random salt)', async () => {
      const hashA = await hashPassword(VALID_PASSWORD)
      const hashB = await hashPassword(VALID_PASSWORD)
      expect(hashA).not.toBe(hashB)
    })

    it('rejects an empty password', async () => {
      await expect(hashPassword('')).rejects.toThrow(PasswordValidationError)
    })

    it('rejects a whitespace-only password', async () => {
      await expect(hashPassword('        ')).rejects.toThrow(PasswordValidationError)
    })

    it('rejects a password shorter than the minimum length', async () => {
      await expect(hashPassword('short1')).rejects.toThrow(PasswordValidationError)
    })

    it('accepts a password at exactly the minimum length', async () => {
      await expect(hashPassword('12345678')).resolves.toMatch(/^\$argon2id\$/)
    })

    it('rejects a password longer than the maximum length', async () => {
      await expect(hashPassword('a'.repeat(257))).rejects.toThrow(PasswordValidationError)
    })

    it('accepts a password at exactly the maximum length', async () => {
      await expect(hashPassword('a'.repeat(256))).resolves.toMatch(/^\$argon2id\$/)
    })

    it('never includes the plaintext password anywhere in the resulting hash string', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      expect(hash).not.toContain(VALID_PASSWORD)
    })
  })

  describe('verifyPassword', () => {
    it('verifies a correct password', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      await expect(verifyPassword(VALID_PASSWORD, hash)).resolves.toBe(true)
    })

    it('rejects an incorrect password', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      await expect(verifyPassword('wrong password entirely', hash)).resolves.toBe(false)
    })

    it('is case-sensitive', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      await expect(verifyPassword(VALID_PASSWORD.toUpperCase(), hash)).resolves.toBe(false)
    })

    it('produces a controlled PasswordHashFormatError for a malformed stored hash, not a crash', async () => {
      await expect(verifyPassword(VALID_PASSWORD, 'not-a-real-argon2-hash')).rejects.toThrow(
        PasswordHashFormatError
      )
    })

    it('produces a controlled PasswordHashFormatError for an empty stored hash', async () => {
      await expect(verifyPassword(VALID_PASSWORD, '')).rejects.toThrow(PasswordHashFormatError)
    })

    it('verifies correctly against the embedded DUMMY_PASSWORD_HASH constant (used for anti-enumeration)', async () => {
      // The dummy hash is a real, well-formed Argon2id hash — it just
      // doesn't protect anything real. Confirms it round-trips.
      const isValid = await verifyPassword(
        'dummy-password-for-timing-consistency-only',
        DUMMY_PASSWORD_HASH
      )
      expect(isValid).toBe(true)
    })
  })

  describe('needsRehash', () => {
    it('returns false for a hash using the current parameters', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      expect(needsRehash(hash)).toBe(false)
    })

    it('returns true for a hash using different parameters', () => {
      const outdatedHash =
        '$argon2id$v=19$m=4096,t=1,p=1$AAECAwQFBgcICQoLDA0ODw$vgjwpUdAUNSExMbAdNRcYSAC3hcDWJQ7HKzYe6WX+Uc'
      expect(needsRehash(outdatedHash)).toBe(true)
    })

    it('returns true (safer default) for a hash whose parameters cannot be parsed', () => {
      expect(needsRehash('not-a-real-hash-at-all')).toBe(true)
    })
  })

  describe('no accidental plaintext/hash exposure', () => {
    it('a thrown PasswordValidationError message does not include the offending password', async () => {
      const suspiciousPassword = 'shrt'
      let thrown: unknown
      try {
        await hashPassword(suspiciousPassword)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(PasswordValidationError)
      expect((thrown as Error).message).not.toContain(suspiciousPassword)
    })
  })

  describe('validatePasswordHashForStorage (the persistence-boundary gate)', () => {
    it('accepts a hash actually returned by hashPassword', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      expect(() => validatePasswordHashForStorage(hash)).not.toThrow()
    })

    it('rejects plaintext outright', () => {
      expect(() => validatePasswordHashForStorage('my-plain-password')).toThrow(
        PasswordHashValidationError
      )
    })

    it('rejects an empty string', () => {
      expect(() => validatePasswordHashForStorage('')).toThrow(PasswordHashValidationError)
    })

    it('rejects a malformed PHC-shaped string', () => {
      expect(() => validatePasswordHashForStorage('$argon2id$not-well-formed')).toThrow(
        PasswordHashValidationError
      )
    })

    it('rejects an argon2i hash', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      const argon2iHash = hash.replace('$argon2id$', '$argon2i$')
      expect(() => validatePasswordHashForStorage(argon2iHash)).toThrow(PasswordHashValidationError)
    })

    it('rejects an argon2d hash', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      const argon2dHash = hash.replace('$argon2id$', '$argon2d$')
      expect(() => validatePasswordHashForStorage(argon2dHash)).toThrow(PasswordHashValidationError)
    })

    it('rejects a hash using an outdated/wrong version', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      const wrongVersionHash = hash.replace('v=19', 'v=18')
      expect(() => validatePasswordHashForStorage(wrongVersionHash)).toThrow(
        PasswordHashValidationError
      )
    })

    it('rejects a hash using outdated/wrong m/t/p parameters', async () => {
      const hash = await hashPassword(VALID_PASSWORD)
      const wrongParamsHash = hash.replace('m=65536,t=3,p=1', 'm=19456,t=2,p=1')
      expect(() => validatePasswordHashForStorage(wrongParamsHash)).toThrow(
        PasswordHashValidationError
      )
    })

    it('does not include the rejected value in its error message', () => {
      const suspiciousValue = 'a-very-identifiable-plaintext-value-xyz123'
      let thrown: unknown
      try {
        validatePasswordHashForStorage(suspiciousValue)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(PasswordHashValidationError)
      expect((thrown as Error).message).not.toContain(suspiciousValue)
    })
  })
})

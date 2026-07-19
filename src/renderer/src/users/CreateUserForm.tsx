import { useEffect, useState, type FormEvent } from 'react'
import { FormField } from '../setup/FormField'
import { errorBannerStyle, labelStyle, primaryButtonStyle, secondaryButtonStyle } from '../setup/ui'
import type { AssignableRole, NonOwnerRoleCode } from '../../../shared/ipc/users'

interface CreateUserFormProps {
  onCreated: () => void
  onCancel: () => void
}

/**
 * The role picker is populated from listAssignableRoles() — the exact
 * fixed set userManagementService accepts, gated by the same
 * requireOwnerCaller authorization as every other privileged
 * operation — never a hand-typed option list that could drift out of
 * sync with, or (worse) include 'owner' by a future editing mistake.
 */
export function CreateUserForm({ onCreated, onCancel }: CreateUserFormProps) {
  const [roles, setRoles] = useState<AssignableRole[]>([])
  const [displayName, setDisplayName] = useState('')
  const [loginIdentifier, setLoginIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [roleCode, setRoleCode] = useState<NonOwnerRoleCode | ''>('')
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.ledgerpage.listAssignableRoles().then((result) => {
      if (cancelled) {
        return
      }
      if (!result.success) {
        setError(describeCreateError(result.errorCode))
        return
      }
      setRoles(result.roles)
      if (result.roles.length > 0) {
        setRoleCode(result.roles[0].code)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const passwordsMatch = password.length > 0 && password === passwordConfirmation
  const isValid =
    displayName.trim().length > 0 &&
    loginIdentifier.trim().length > 0 &&
    passwordsMatch &&
    roleCode !== ''

  async function handleSubmit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (isBusy || !isValid) {
      return
    }
    setIsBusy(true)
    setError(undefined)
    try {
      const result = await window.ledgerpage.createUser({
        displayName,
        loginIdentifier,
        password,
        passwordConfirmation,
        roleCode: roleCode as NonOwnerRoleCode
      })
      if (!result.success) {
        setError(describeCreateError(result.errorCode))
        return
      }
      onCreated()
    } catch {
      setError('Something went wrong creating this user. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate style={{ maxWidth: '28rem' }}>
      {error && <div style={errorBannerStyle}>{error}</div>}

      <FormField
        id="new-user-display-name"
        label="Name"
        value={displayName}
        onChange={setDisplayName}
        disabled={isBusy}
        autoFocus
      />
      <FormField
        id="new-user-login-identifier"
        label="Username"
        value={loginIdentifier}
        onChange={setLoginIdentifier}
        autoComplete="off"
        disabled={isBusy}
      />

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="new-user-role" style={labelStyle}>
          Role
        </label>
        <select
          id="new-user-role"
          value={roleCode}
          onChange={(event) => setRoleCode(event.target.value as NonOwnerRoleCode)}
          disabled={isBusy || roles.length === 0}
          style={{ width: '100%', padding: '0.625rem 0.75rem', fontSize: '0.9375rem' }}
        >
          {roles.map((role) => (
            <option key={role.code} value={role.code}>
              {role.name}
            </option>
          ))}
        </select>
      </div>

      <FormField
        id="new-user-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        disabled={isBusy}
      />
      <FormField
        id="new-user-password-confirmation"
        label="Confirm password"
        type="password"
        value={passwordConfirmation}
        onChange={setPasswordConfirmation}
        autoComplete="new-password"
        disabled={isBusy}
        errorText={
          passwordConfirmation.length > 0 && !passwordsMatch
            ? 'Passwords don\u2019t match.'
            : undefined
        }
      />

      <button
        type="submit"
        disabled={isBusy || !isValid}
        style={primaryButtonStyle(isBusy || !isValid)}
      >
        {isBusy ? 'Creating\u2026' : 'Create user'}
      </button>
      <button type="button" onClick={onCancel} disabled={isBusy} style={secondaryButtonStyle}>
        Cancel
      </button>
    </form>
  )
}

function describeCreateError(errorCode: string): string {
  switch (errorCode) {
    case 'invalid_input':
      return 'Some of the details you entered aren\u2019t valid. Check them and try again.'
    case 'duplicate_login_identifier':
      return 'That username is already taken.'
    case 'not_authorized':
    case 'session_invalid':
      return 'You\u2019re no longer able to make this change. Try signing in again.'
    default:
      return 'Something went wrong creating this user. Try again.'
  }
}

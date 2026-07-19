import { useState, type FormEvent } from 'react'
import { FormField } from './FormField'
import { headingStyle, primaryButtonStyle, subheadingStyle } from './ui'
import { SETUP_PASSWORD_MAX_LENGTH, SETUP_PASSWORD_MIN_LENGTH } from '../../../shared/ipc/setup'
import type { SetupOwnerInput } from '../../../shared/ipc/setup'

interface OwnerAccountStepProps {
  initialValue: SetupOwnerInput
  onContinue: (value: SetupOwnerInput) => void
  onBack: () => void
}

const MIN_LOGIN_IDENTIFIER_LENGTH = 3

export function OwnerAccountStep({ initialValue, onContinue, onBack }: OwnerAccountStepProps) {
  const [displayName, setDisplayName] = useState(initialValue.displayName)
  const [loginIdentifier, setLoginIdentifier] = useState(initialValue.loginIdentifier)
  const [password, setPassword] = useState(initialValue.password)
  const [passwordConfirmation, setPasswordConfirmation] = useState(
    initialValue.passwordConfirmation
  )
  const [touched, setTouched] = useState(false)

  const trimmedDisplayName = displayName.trim()
  const trimmedLoginIdentifier = loginIdentifier.trim()

  const displayNameError =
    touched && trimmedDisplayName.length === 0 ? 'Enter your name.' : undefined

  let loginIdentifierError: string | undefined
  if (touched) {
    if (trimmedLoginIdentifier.length === 0) {
      loginIdentifierError = 'Choose a username to sign in with.'
    } else if (/\s/.test(trimmedLoginIdentifier)) {
      loginIdentifierError = 'Usernames cannot contain spaces.'
    } else if (trimmedLoginIdentifier.length < MIN_LOGIN_IDENTIFIER_LENGTH) {
      loginIdentifierError = `Usernames need at least ${String(MIN_LOGIN_IDENTIFIER_LENGTH)} characters.`
    }
  }

  let passwordError: string | undefined
  if (touched) {
    if (password.length < SETUP_PASSWORD_MIN_LENGTH) {
      passwordError = `Use at least ${String(SETUP_PASSWORD_MIN_LENGTH)} characters.`
    } else if (password.length > SETUP_PASSWORD_MAX_LENGTH) {
      passwordError = `Use no more than ${String(SETUP_PASSWORD_MAX_LENGTH)} characters.`
    }
  }

  const passwordConfirmationError =
    touched && passwordConfirmation.length > 0 && passwordConfirmation !== password
      ? 'Passwords don\u2019t match.'
      : undefined

  const isValid =
    trimmedDisplayName.length > 0 &&
    trimmedLoginIdentifier.length >= MIN_LOGIN_IDENTIFIER_LENGTH &&
    !/\s/.test(trimmedLoginIdentifier) &&
    password.length >= SETUP_PASSWORD_MIN_LENGTH &&
    password.length <= SETUP_PASSWORD_MAX_LENGTH &&
    password === passwordConfirmation

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    setTouched(true)
    if (!isValid) {
      return
    }
    onContinue({
      displayName: trimmedDisplayName,
      loginIdentifier: trimmedLoginIdentifier,
      password,
      passwordConfirmation
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 style={headingStyle}>Create the Owner account</h1>
      <p style={subheadingStyle}>
        The Owner has full access to LedgerPage. You can add more people later.
      </p>

      <FormField
        id="owner-display-name"
        label="Your name"
        value={displayName}
        onChange={setDisplayName}
        autoComplete="name"
        errorText={displayNameError}
        autoFocus
      />
      <FormField
        id="owner-login-identifier"
        label="Username"
        value={loginIdentifier}
        onChange={setLoginIdentifier}
        autoComplete="username"
        helpText="What you'll type to sign in. No spaces."
        errorText={loginIdentifierError}
      />
      <FormField
        id="owner-password"
        label="Password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        helpText={`At least ${String(SETUP_PASSWORD_MIN_LENGTH)} characters.`}
        errorText={passwordError}
      />
      <FormField
        id="owner-password-confirmation"
        label="Confirm password"
        type="password"
        value={passwordConfirmation}
        onChange={setPasswordConfirmation}
        autoComplete="new-password"
        errorText={passwordConfirmationError}
      />

      <button type="submit" style={primaryButtonStyle(false)}>
        Continue
      </button>
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'center',
          marginTop: '0.75rem',
          padding: '0.5rem',
          fontSize: '0.8125rem',
          color: '#5B6472',
          background: 'none',
          border: 'none',
          cursor: 'pointer'
        }}
      >
        Back
      </button>
    </form>
  )
}

import type { ChangeEvent } from 'react'
import { errorTextStyle, fieldGroupStyle, helpTextStyle, inputStyle, labelStyle } from './ui'

interface FormFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'password'
  autoComplete?: string
  helpText?: string
  errorText?: string
  disabled?: boolean
  autoFocus?: boolean
}

/**
 * A labeled text/password field with an always-associated <label
 * htmlFor> (keyboard/screen-reader accessible without any extra
 * wiring) and an inline error message shown only once one is present
 * — "useful inline validation," not a wall of red before the person
 * has even typed anything.
 */
export function FormField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  helpText,
  errorText,
  disabled,
  autoFocus
}: FormFieldProps) {
  function handleChange(event: ChangeEvent<HTMLInputElement>): void {
    onChange(event.target.value)
  }

  return (
    <div style={fieldGroupStyle}>
      <label htmlFor={id} style={labelStyle}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        onChange={handleChange}
        autoComplete={autoComplete}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText ? `${id}-error` : helpText ? `${id}-help` : undefined}
        style={inputStyle(Boolean(errorText))}
      />
      {errorText ? (
        <p id={`${id}-error`} role="alert" style={errorTextStyle}>
          {errorText}
        </p>
      ) : helpText ? (
        <p id={`${id}-help`} style={helpTextStyle}>
          {helpText}
        </p>
      ) : null}
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { FormField } from './FormField'
import { headingStyle, primaryButtonStyle, subheadingStyle } from './ui'
import type { SetupCompanyInput } from '../../../shared/ipc/setup'

interface CompanyDetailsStepProps {
  initialValue: SetupCompanyInput
  onContinue: (value: SetupCompanyInput) => void
}

export function CompanyDetailsStep({ initialValue, onContinue }: CompanyDetailsStepProps) {
  const [name, setName] = useState(initialValue.name)
  const [address, setAddress] = useState(initialValue.address)
  const [contactDetails, setContactDetails] = useState(initialValue.contactDetails)
  const [touched, setTouched] = useState(false)

  const nameError = touched && name.trim().length === 0 ? 'Enter your company name.' : undefined
  const addressError =
    touched && address.trim().length === 0 ? 'Enter your company address.' : undefined
  const contactError =
    touched && contactDetails.trim().length === 0 ? 'Enter a way to reach your company.' : undefined

  const isValid =
    name.trim().length > 0 && address.trim().length > 0 && contactDetails.trim().length > 0

  function handleSubmit(event: FormEvent): void {
    event.preventDefault()
    setTouched(true)
    if (!isValid) {
      return
    }
    onContinue({
      name: name.trim(),
      address: address.trim(),
      contactDetails: contactDetails.trim()
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h1 style={headingStyle}>Tell us about your company</h1>
      <p style={subheadingStyle}>
        This appears on your documents and reports. You can change it later.
      </p>

      <FormField
        id="company-name"
        label="Company name"
        value={name}
        onChange={setName}
        errorText={nameError}
        autoFocus
      />
      <FormField
        id="company-address"
        label="Address"
        value={address}
        onChange={setAddress}
        errorText={addressError}
      />
      <FormField
        id="company-contact"
        label="Contact details"
        value={contactDetails}
        onChange={setContactDetails}
        helpText="A phone number or email address customers and suppliers can reach you at."
        errorText={contactError}
      />

      <button type="submit" style={primaryButtonStyle(false)}>
        Continue
      </button>
    </form>
  )
}

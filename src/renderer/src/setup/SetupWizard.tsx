import { useState } from 'react'
import { WizardShell } from './WizardShell'
import { CompanyDetailsStep } from './CompanyDetailsStep'
import { CurrencyConfirmationStep } from './CurrencyConfirmationStep'
import { OwnerAccountStep } from './OwnerAccountStep'
import { RecoveryKeyDisplayStep } from './RecoveryKeyDisplayStep'
import { RecoveryKeyConfirmStep } from './RecoveryKeyConfirmStep'
import { CompletionStep } from './CompletionStep'
import { errorBannerStyle } from './ui'
import type { SetupCompanyInput, SetupErrorCode, SetupOwnerInput } from '../../../shared/ipc/setup'

type WizardStep =
  'company' | 'currency' | 'owner' | 'recoveryDisplay' | 'recoveryConfirm' | 'completion'

const STEP_INDEX: Record<Exclude<WizardStep, 'completion'>, number> = {
  company: 0,
  currency: 1,
  owner: 2,
  recoveryDisplay: 3,
  recoveryConfirm: 4
}

const EMPTY_COMPANY: SetupCompanyInput = { name: '', address: '', contactDetails: '' }
const EMPTY_OWNER: SetupOwnerInput = {
  displayName: '',
  loginIdentifier: '',
  password: '',
  passwordConfirmation: ''
}

function describeErrorCode(errorCode: SetupErrorCode): string {
  switch (errorCode) {
    case 'setup_already_complete':
      return 'Setup has already been completed on this computer.'
    case 'invalid_input':
      return 'Some of the details you entered aren\u2019t valid. Check the previous steps and try again.'
    case 'recovery_confirmation_invalid':
      return 'Your recovery key confirmation is no longer valid. Generate a new key and try again.'
    case 'unexpected_error':
      return 'Something went wrong completing setup. Try again.'
  }
}

/**
 * Owns every piece of state this wizard needs, across all six stages,
 * and is the only place that calls window.ledgerpage's setup methods
 * — no step component talks to IPC directly. The recovery key's
 * plaintext lives here only between prepareRecoveryKey resolving and
 * handleRecoveryAcknowledge running; it is set to null there and never
 * set again, so RecoveryKeyDisplayStep structurally cannot be shown a
 * key twice from this component's own state.
 */
export function SetupWizard() {
  const [step, setStep] = useState<WizardStep>('company')
  const [company, setCompany] = useState<SetupCompanyInput>(EMPTY_COMPANY)
  const [owner, setOwner] = useState<SetupOwnerInput>(EMPTY_OWNER)
  const [ceremonyToken, setCeremonyToken] = useState<string | null>(null)
  const [plaintextRecoveryKey, setPlaintextRecoveryKey] = useState<string | null>(null)

  // A single busy flag disables every submit control on the active
  // step while any request is in flight — the concrete mechanism
  // behind "loading states that prevent double submission."
  const [isBusy, setIsBusy] = useState(false)
  const [wizardError, setWizardError] = useState<string | undefined>(undefined)
  const [recoveryConfirmError, setRecoveryConfirmError] = useState<string | undefined>(undefined)

  async function prepareAndShowRecoveryKey(): Promise<void> {
    setIsBusy(true)
    setWizardError(undefined)
    try {
      const prepared = await window.ledgerpage.prepareRecoveryKey()
      if (!prepared.success) {
        setWizardError('Could not generate a recovery key. Try again.')
        return
      }
      setCeremonyToken(prepared.ceremonyToken)
      setPlaintextRecoveryKey(prepared.plaintextRecoveryKey)
      setStep('recoveryDisplay')
    } catch {
      setWizardError('Could not generate a recovery key. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  function handleCompanyContinue(value: SetupCompanyInput): void {
    setCompany(value)
    setWizardError(undefined)
    setStep('currency')
  }

  function handleCurrencyContinue(): void {
    setWizardError(undefined)
    setStep('owner')
  }

  function handleCurrencyBack(): void {
    setStep('company')
  }

  async function handleOwnerContinue(value: SetupOwnerInput): Promise<void> {
    setOwner(value)
    await prepareAndShowRecoveryKey()
  }

  function handleOwnerBack(): void {
    setStep('currency')
  }

  function handleRecoveryAcknowledge(): void {
    // The one and only discard point — from here on, nothing in this
    // component's state holds the plaintext key.
    setPlaintextRecoveryKey(null)
    setRecoveryConfirmError(undefined)
    setStep('recoveryConfirm')
  }

  async function handleRegenerateKey(): Promise<void> {
    if (ceremonyToken) {
      try {
        await window.ledgerpage.cancelRecoveryKey({ ceremonyToken })
      } catch {
        // Cancellation failing is not itself fatal — prepareRecoveryKey
        // below mints a fresh ceremony regardless, and the old one (if
        // it somehow survived) will simply expire on its own.
      }
    }
    setCeremonyToken(null)
    setRecoveryConfirmError(undefined)
    await prepareAndShowRecoveryKey()
  }

  async function handleRecoveryConfirmSubmit(reenteredKey: string): Promise<void> {
    if (!ceremonyToken || isBusy) {
      return
    }
    setIsBusy(true)
    setRecoveryConfirmError(undefined)
    setWizardError(undefined)

    try {
      const confirmResult = await window.ledgerpage.confirmRecoveryKey({
        ceremonyToken,
        reenteredKey
      })
      if (!confirmResult.success) {
        setRecoveryConfirmError(
          'That key doesn\u2019t match what you saved. Check it and try again.'
        )
        return
      }

      const completeResult = await window.ledgerpage.completeSetup({
        company,
        owner,
        commitToken: confirmResult.commitToken
      })
      if (!completeResult.success) {
        setRecoveryConfirmError(describeErrorCode(completeResult.errorCode))
        return
      }

      setStep('completion')
    } catch {
      setRecoveryConfirmError('Something went wrong. Try again.')
    } finally {
      setIsBusy(false)
    }
  }

  const activeStepIndex = step === 'completion' ? undefined : STEP_INDEX[step]

  return (
    <WizardShell activeStepIndex={activeStepIndex}>
      {wizardError && <div style={errorBannerStyle}>{wizardError}</div>}

      {step === 'company' && (
        <CompanyDetailsStep initialValue={company} onContinue={handleCompanyContinue} />
      )}

      {step === 'currency' && (
        <CurrencyConfirmationStep onContinue={handleCurrencyContinue} onBack={handleCurrencyBack} />
      )}

      {step === 'owner' && (
        <OwnerAccountStep
          initialValue={owner}
          onContinue={handleOwnerContinue}
          onBack={handleOwnerBack}
        />
      )}

      {step === 'recoveryDisplay' && plaintextRecoveryKey && (
        <RecoveryKeyDisplayStep
          plaintextRecoveryKey={plaintextRecoveryKey}
          onAcknowledge={handleRecoveryAcknowledge}
        />
      )}

      {step === 'recoveryConfirm' && (
        <RecoveryKeyConfirmStep
          isSubmitting={isBusy}
          submitError={recoveryConfirmError}
          onSubmit={(reenteredKey) => void handleRecoveryConfirmSubmit(reenteredKey)}
          onRegenerateKey={() => void handleRegenerateKey()}
        />
      )}

      {step === 'completion' && <CompletionStep />}
    </WizardShell>
  )
}

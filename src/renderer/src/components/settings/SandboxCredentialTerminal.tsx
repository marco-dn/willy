import { translate } from '@/i18n/i18n'
import type { SandboxTarget } from '../../../../shared/sandbox-policy-types'
import { Button } from '../ui/button'
import { useSandboxCredentialTerminal } from './useSandboxCredentialTerminal'

export function SandboxCredentialTerminal({
  target,
  sessionId,
  onClose
}: {
  target: SandboxTarget
  sessionId: string
  onClose: () => void
}): React.JSX.Element {
  const { containerRef, status } = useSandboxCredentialTerminal(target, sessionId)
  const message =
    status === 'opening'
      ? translate('settings.sandbox.credentialsOpening', 'Opening private sbx prompt…')
      : status === 'active'
        ? translate(
            'settings.sandbox.credentialsActive',
            'Enter the token only in this terminal. Close the prompt to cancel.'
          )
        : status === 'completed'
          ? translate(
              'settings.sandbox.credentialsCompleted',
              'sbx finished successfully. Git authentication has not been verified.'
            )
          : status === 'cancelled'
            ? translate(
                'settings.sandbox.credentialsCancelled',
                'Prompt cancelled. Credential status has not been verified.'
              )
            : translate(
                'settings.sandbox.credentialsFailed',
                'The prompt could not complete. Credential status has not been verified.'
              )
  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-muted-foreground">
        {message}
      </p>
      <div
        ref={containerRef}
        className="h-64 w-full overflow-hidden rounded-md border border-border bg-background text-foreground"
        role="group"
        aria-label={translate(
          'settings.sandbox.credentialsTerminal',
          'Private GitHub credential terminal'
        )}
      />
      <Button variant="outline" size="sm" onClick={onClose}>
        {translate('settings.sandbox.closePrompt', 'Close prompt')}
      </Button>
    </div>
  )
}

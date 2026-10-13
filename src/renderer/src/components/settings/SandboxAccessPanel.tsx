import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import type {
  SandboxTarget,
  SandboxPolicySnapshot,
  SandboxNetworkCheck
} from '../../../../shared/sandbox-policy-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { SandboxNetworkRules } from './SandboxNetworkRules'
import { SandboxCredentialTerminal } from './SandboxCredentialTerminal'

export function SandboxAccessPanel({
  target,
  disabled
}: {
  target: SandboxTarget
  disabled: boolean
}): React.JSX.Element {
  useTranslation()
  const mounted = useMountedRef()
  const inFlight = useRef(false)
  const [snapshot, setSnapshot] = useState<SandboxPolicySnapshot>()
  const [check, setCheck] = useState<SandboxNetworkCheck>()
  const [destination, setDestination] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [credentialSession, setCredentialSession] = useState<string>()
  const execute = useCallback(
    async (action: 'list' | 'add' | 'remove' | 'check', destination?: string, ruleId?: string) => {
      if (inFlight.current) {
        return
      }
      inFlight.current = true
      setBusy(true)
      setError(undefined)
      setCheck(undefined)
      if (action === 'list') {
        setSnapshot(undefined)
      }
      try {
        const result = await window.api.sandboxes.policy({
          target: { name: target.name, id: target.id },
          action,
          destination,
          ruleId
        })
        if (mounted.current) {
          if ('rules' in result) {
            setSnapshot(result)
            setCheck(result.check)
          } else {
            setCheck(result)
          }
        }
      } catch (error) {
        if (mounted.current) {
          setError(String(error))
          setSnapshot(undefined)
        }
      } finally {
        inFlight.current = false
        if (mounted.current) {
          setBusy(false)
        }
      }
    },
    [mounted, target.name, target.id]
  )
  useEffect(() => {
    void execute('list')
  }, [execute])
  const blocked = disabled || busy || Boolean(credentialSession)
  return (
    <div className="space-y-4 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">
        {translate(
          'settings.sandbox.networkScope',
          'Changes apply only to this sandbox. Inherited policies are read-only.'
        )}
      </p>
      <Button variant="outline" size="sm" disabled={blocked} onClick={() => void execute('list')}>
        {translate('settings.sandbox.refresh', 'Refresh')}
      </Button>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault()
          void execute('add', destination)
        }}
      >
        <Label htmlFor={`network-destination-${target.id}`}>
          {translate('settings.sandbox.destination', 'TCP destination')}
        </Label>
        <Input
          id={`network-destination-${target.id}`}
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="example.com:443"
          disabled={blocked}
          required
          maxLength={300}
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.sandbox.destinationHelp',
            'Domain, *.domain or **.domain, with an optional port. To check access, enter a concrete host; the default port is 443.'
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={blocked || !snapshot || !destination.trim()}>
            {translate('settings.sandbox.addRule', 'Allow destination')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={blocked || !destination.trim()}
            onClick={() => void execute('check', destination)}
          >
            {translate('settings.sandbox.checkAccess', 'Check access')}
          </Button>
        </div>
      </form>
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('settings.sandbox.loadingPolicies', 'Reading or updating sandbox policies…')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {check ? (
        <div role="status" className="space-y-1 text-sm">
          <p>
            {check.allowed
              ? translate('settings.sandbox.accessAllowed', 'Policy allows {{target}}.', {
                  target: check.target
                })
              : translate('settings.sandbox.accessDenied', 'Policy denies {{target}}.', {
                  target: check.target
                })}
          </p>
          {check.governanceActive ? (
            <p>
              {translate(
                'settings.sandbox.governanceActive',
                'Organization policies apply. A sandbox rule cannot override an organization denial.'
              )}
            </p>
          ) : null}
          {check.reason ? (
            <p className="break-all text-xs text-muted-foreground">{check.reason}</p>
          ) : null}
          {check.denyKind ? (
            <p className="text-xs text-muted-foreground">
              {translate('settings.sandbox.denyKind', 'Denial type: {{kind}}', {
                kind: check.denyKind
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {snapshot ? (
        <SandboxNetworkRules
          rules={snapshot.rules}
          disabled={blocked}
          onRemove={(id) => void execute('remove', undefined, id)}
        />
      ) : null}
      <div className="space-y-2 border-t border-border pt-3">
        <h4 className="text-sm font-medium">
          {translate('settings.sandbox.githubCredentials', 'GitHub API credentials (optional)')}
        </h4>
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.sandbox.credentialsHelp',
            'sbx stores the token for this sandbox. Willy does not save terminal input or output in session history or logs. Git clone/push authentication is separate; an API token does not verify Git access.'
          )}
        </p>
        {credentialSession ? (
          <SandboxCredentialTerminal
            target={target}
            sessionId={credentialSession}
            onClose={() => setCredentialSession(undefined)}
          />
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={blocked}
            onClick={() => setCredentialSession(createNonSecureContextUuid())}
          >
            {translate('settings.sandbox.openCredentials', 'Open GitHub credential prompt')}
          </Button>
        )}
      </div>
    </div>
  )
}

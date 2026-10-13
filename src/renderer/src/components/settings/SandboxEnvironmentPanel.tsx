import { useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import type { SandboxEnvironmentReport } from '../../../../shared/sandbox-environment-types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'

export function SandboxEnvironmentPanel({
  record,
  disabled,
  onPrepare
}: {
  record: ManagedSandbox
  disabled: boolean
  onPrepare: () => void
}): React.JSX.Element {
  const mounted = useMountedRef()
  const active = useRef(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SandboxEnvironmentReport>()
  const [error, setError] = useState<string>()
  const [connected, setConnected] = useState(false)
  const report =
    result && (!record.verification || result.checkedAt >= record.verification.checkedAt)
      ? result
      : record.verification
  const perform = async (action: () => Promise<void>) => {
    if (active.current || disabled) {
      return
    }
    active.current = true
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      active.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="space-y-3">
      <p className="text-sm font-medium">
        {translate('settings.sandbox.projectsAndTools', 'Projects and tools')}
      </p>
      <p className="text-sm text-muted-foreground">
        {translate(
          'settings.sandbox.verifyNotice',
          'Verification checks a running sandbox without installing tools or configuring SSH. Start the sandbox first if it is stopped.'
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy || !record.sandboxId}
          onClick={() =>
            void perform(async () => {
              if (!record.sandboxId) {
                return
              }
              const next = await window.api.sandboxes.verifyEnvironment({
                name: record.name,
                id: record.sandboxId
              })
              if (mounted.current) {
                setResult(next)
                setConnected(false)
              }
            })
          }
        >
          {busy
            ? translate('settings.sandbox.verifying', 'Checking environment…')
            : translate('settings.sandbox.verifyEnvironment', 'Verify environment')}
        </Button>
        {report?.canPrepare ? (
          <Button size="sm" disabled={disabled || busy} onClick={onPrepare}>
            {translate('settings.sandbox.prepareEnvironment', 'Prepare environment')}
          </Button>
        ) : null}
        {report?.outcome === 'ready' && record.sshTargetId ? (
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || busy}
            onClick={() =>
              void perform(async () => {
                if (!record.sshTargetId) {
                  return
                }
                const state = await window.api.ssh.connect({ targetId: record.sshTargetId })
                if (state?.status !== 'connected') {
                  throw new Error(
                    state?.error ||
                      translate(
                        'settings.sandbox.sshNotReady',
                        'SSH connection is not ready. Check SSH settings.'
                      )
                  )
                }
                if (mounted.current) {
                  setConnected(true)
                }
              })
            }
          >
            {translate('settings.sandbox.connectSsh', 'Connect SSH')}
          </Button>
        ) : null}
      </div>
      {report ? (
        <>
          <p role="status" className="text-sm">
            {report.outcome === 'ready'
              ? translate(
                  'settings.sandbox.environmentReady',
                  'Prerequisites verified. Connect SSH before linking a project; connection may install or update the Willy relay.'
                )
              : report.canPrepare
                ? translate(
                    'settings.sandbox.environmentMissing',
                    'Some prerequisites are missing. Review the results, then prepare the environment explicitly.'
                  )
                : translate(
                    'settings.sandbox.environmentUnavailable',
                    'Verification could not confirm this environment. Resolve the reported errors and retry.'
                  )}
          </p>
          <details key={report.checkedAt} open={report.outcome !== 'ready'}>
            <summary className="cursor-pointer text-sm">
              {translate('settings.sandbox.verificationDetails', 'Verification details')}
            </summary>
            <ul className="space-y-2">
              {report.checks.map((check) => (
                <li key={check.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{check.id}</span>
                    <Badge variant="outline">
                      {check.status === 'ok'
                        ? translate('settings.sandbox.checkOk', 'Verified')
                        : check.status === 'missing'
                          ? translate('settings.sandbox.checkMissing', 'Missing')
                          : translate('settings.sandbox.stateUnavailable', 'State unavailable')}
                    </Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{check.detail}</p>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      {connected ? (
        <p role="status" className="text-sm">
          {translate('settings.sandbox.sshConnected', 'SSH connection completed.')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  )
}

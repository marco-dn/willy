import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { SandboxInspection } from '../../../../shared/sandbox-types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { SandboxProvisioning } from './SandboxProvisioning'
import { sandboxErrorCopy, sandboxStatusCopy } from './sandbox-status-copy'

type InspectionState =
  | { status: 'loading' }
  | { status: 'loaded'; inspection: SandboxInspection }
  | { status: 'failed' }

export function SandboxPane(): React.JSX.Element {
  useTranslation()
  const [state, setState] = useState<InspectionState>({ status: 'loading' })
  const inFlight = useRef(false)
  const mounted = useMountedRef()
  const refresh = useCallback(async () => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setState({ status: 'loading' })
    try {
      const inspection = await window.api.sandboxes.inspect()
      if (mounted.current) {
        setState({ status: 'loaded', inspection })
      }
    } catch {
      if (mounted.current) {
        setState({ status: 'failed' })
      }
    } finally {
      inFlight.current = false
    }
  }, [mounted])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <div className="space-y-4" aria-busy={state.status === 'loading'}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">
          {translate('settings.sandbox.diagnostics', 'Diagnostics')}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={state.status === 'loading'}
          onClick={() => void refresh()}
        >
          <RefreshCw />
          {translate('settings.sandbox.refresh', 'Refresh')}
        </Button>
      </div>
      {state.status === 'loading' ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          {translate('settings.sandbox.checking', 'Checking local sbx…')}
        </p>
      ) : state.status === 'failed' ? (
        <p role="alert" className="text-sm text-destructive">
          {translate(
            'settings.sandbox.ipcFailed',
            'Could not load sandbox diagnostics. Refresh to try again.'
          )}
        </p>
      ) : (
        <SandboxInspectionResult inspection={state.inspection} />
      )}
      <SandboxProvisioning
        available={state.status === 'loaded' && state.inspection.status === 'ready'}
        sandboxes={
          state.status === 'loaded' && state.inspection.status === 'ready'
            ? state.inspection.sandboxes
            : []
        }
      />
      <Button variant="link" asChild>
        <a href="https://docs.docker.com/ai/sandboxes/install/" target="_blank" rel="noreferrer">
          {translate('settings.sandbox.installGuide', 'Docker Sandboxes installation guide')}
        </a>
      </Button>
      <p className="text-xs text-muted-foreground">
        {translate(
          'settings.sandbox.provisioningLimit',
          'Project linking and credential setup are not available yet.'
        )}
      </p>
    </div>
  )
}

function SandboxInspectionResult({
  inspection
}: {
  inspection: SandboxInspection
}): React.JSX.Element {
  return (
    <div className="space-y-3">
      {inspection.cliPath ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="break-all font-mono">{inspection.cliPath}</p>
          {inspection.clientVersion ? (
            <p>
              {translate('settings.sandbox.clientVersion', 'sbx CLI: {{version}}', {
                version: inspection.clientVersion
              })}
            </p>
          ) : null}
          {inspection.serverVersion ? (
            <p>
              {translate('settings.sandbox.serverVersion', 'sbx service: {{version}}', {
                version: inspection.serverVersion
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {inspection.status === 'error' ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-destructive">{sandboxErrorCopy(inspection.reason)}</p>
          {inspection.detail ? (
            <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground">
              {inspection.detail}
            </pre>
          ) : null}
        </div>
      ) : inspection.sandboxes.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('settings.sandbox.empty', 'No local sandboxes found.')}
        </p>
      ) : (
        <ul
          className="space-y-3"
          aria-label={translate('settings.sandbox.list', 'Local sandboxes')}
        >
          {inspection.sandboxes.map((sandbox) => (
            <li key={sandbox.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="break-all text-sm font-medium">{sandbox.name}</span>
                <Badge variant="secondary">{sandboxStatusCopy(sandbox.status)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {translate('settings.sandbox.agent', 'Agent: {{agent}}', { agent: sandbox.agent })}
              </p>
              <p className="text-xs text-muted-foreground">
                {translate('settings.sandbox.mounts', 'Shared folders')}
              </p>
              {sandbox.workspaces.length ? (
                sandbox.workspaces.map((mount) => (
                  <p key={mount} className="break-all font-mono text-xs">
                    {mount}
                  </p>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  {translate('settings.sandbox.noMounts', 'No shared folders reported.')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

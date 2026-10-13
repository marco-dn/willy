import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, RefreshCw } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { SandboxInspection } from '../../../../shared/sandbox-types'
import { Button } from '../ui/button'
import { SandboxCatalog } from './SandboxCatalog'
import { sandboxErrorCopy } from './sandbox-status-copy'

type InspectionState =
  | { status: 'loading' }
  | { status: 'loaded'; inspection: SandboxInspection }
  | { status: 'failed' }

export function SandboxPane(): React.JSX.Element {
  useTranslation()
  const [state, setState] = useState<InspectionState>({ status: 'loading' })
  const [revision, setRevision] = useState(0)
  const inFlight = useRef(false)
  const refreshRequested = useRef(false)
  const mounted = useMountedRef()
  const refresh = useCallback(async () => {
    refreshRequested.current = true
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setState({ status: 'loading' })
    setRevision((value) => value + 1)
    try {
      do {
        refreshRequested.current = false
        try {
          const inspection = await window.api.sandboxes.inspect()
          if (mounted.current && !refreshRequested.current) {
            setState({ status: 'loaded', inspection })
          }
        } catch {
          if (mounted.current && !refreshRequested.current) {
            setState({ status: 'failed' })
          }
        }
      } while (mounted.current && refreshRequested.current)
    } finally {
      inFlight.current = false
    }
  }, [mounted])

  useEffect(() => {
    void refresh()
    return window.api.repos.onChanged(() => void refresh())
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
      <SandboxCatalog
        revision={revision}
        onInventoryChange={refresh}
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
        <details className="space-y-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-sm">
            {translate('settings.sandbox.diagnosticDetails', 'Diagnostic details')}
          </summary>
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
        </details>
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
      ) : null}
    </div>
  )
}

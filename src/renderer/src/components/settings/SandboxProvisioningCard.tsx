import { useState } from 'react'
import { SandboxAccessPanel } from './SandboxAccessPanel'
import { translate } from '@/i18n/i18n'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { sandboxPhaseCopy } from './sandbox-status-copy'
import { Badge } from '../ui/badge'

export function SandboxProvisioningCard({
  record,
  disabled,
  onConfigure
}: {
  record: ManagedSandbox
  disabled: boolean
  onConfigure: () => void
}): React.JSX.Element {
  const [accessOpen, setAccessOpen] = useState(false)
  const status =
    record.status === 'ready'
      ? translate('settings.sandbox.ready', 'Ready')
      : record.status === 'provisioning'
        ? translate('settings.sandbox.provisioning', 'Provisioning')
        : record.status === 'interrupted'
          ? translate('settings.sandbox.interrupted', 'Interrupted')
          : translate('settings.sandbox.incomplete', 'Incomplete')
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="break-all text-sm font-medium">{record.name}.sbx</span>
        <Badge variant="secondary">{status}</Badge>
      </div>
      <p className="break-all font-mono text-xs">{record.mountPath}</p>
      {record.status === 'provisioning' ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('settings.sandbox.phase', 'Phase: {{phase}}', {
            phase: sandboxPhaseCopy(record.stage)
          })}
        </p>
      ) : null}
      {record.error ? (
        <p role="alert" className="whitespace-pre-wrap break-all text-sm text-destructive">
          {record.error}
        </p>
      ) : null}
      {record.versions.length ? (
        <pre className="whitespace-pre-wrap text-xs">{record.versions.join('\n')}</pre>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm">
          {translate('settings.sandbox.logs', 'Recent logs')}
        </summary>
        <pre className="scrollbar-sleek max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-muted-foreground">
          {record.logs.join('\n')}
        </pre>
      </details>
      <Button variant="outline" size="sm" disabled={disabled} onClick={onConfigure}>
        {translate('settings.sandbox.resume', 'Resume / configure')}
      </Button>
      {record.sandboxId ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled && !accessOpen}
            onClick={() => setAccessOpen((value) => !value)}
          >
            {translate('settings.sandbox.networkCredentials', 'Network and credentials')}
          </Button>
          {accessOpen ? (
            <SandboxAccessPanel
              target={{ name: record.name, id: record.sandboxId }}
              disabled={disabled}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

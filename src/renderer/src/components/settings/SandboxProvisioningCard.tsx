import { SandboxEnvironmentPanel } from './SandboxEnvironmentPanel'
import { SandboxLifecyclePanel } from './SandboxLifecyclePanel'
import { SandboxProjectsPanel } from './SandboxProjectsPanel'
import { useState } from 'react'
import { SandboxAccessPanel } from './SandboxAccessPanel'
import { SandboxCredentialTerminal } from './SandboxCredentialTerminal'
import { translate } from '@/i18n/i18n'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { sandboxPhaseCopy } from './sandbox-status-copy'

export function SandboxProvisioningCard({
  record,
  disabled,
  onConfigure,
  credentialSession,
  onCredentialsClosed
}: {
  record: ManagedSandbox
  disabled: boolean
  onConfigure: () => void
  credentialSession?: string
  onCredentialsClosed?: () => void
}): React.JSX.Element {
  const [accessOpen, setAccessOpen] = useState(false)
  return (
    <div className="space-y-2">
      {credentialSession && record.sandboxId ? (
        record.status === 'ready' ? (
          <SandboxCredentialTerminal
            target={{ name: record.name, id: record.sandboxId }}
            sessionId={credentialSession}
            onClose={() => onCredentialsClosed?.()}
          />
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {translate(
              'settings.sandbox.githubSetupPending',
              'GitHub token setup will open after preparation completes.'
            )}
          </p>
        )
      ) : null}
      {record.sandboxId ? (
        <SandboxLifecyclePanel
          target={{ name: record.name, id: record.sandboxId }}
          disabled={disabled}
        />
      ) : null}
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
        <details>
          <summary className="cursor-pointer text-sm">
            {translate('settings.sandbox.toolsInstalled', 'Tools installed')}
          </summary>
          <pre className="whitespace-pre-wrap text-xs">{record.versions.join('\n')}</pre>
        </details>
      ) : null}
      {record.sandboxId ? (
        <SandboxEnvironmentPanel
          key={record.operationId}
          record={record}
          disabled={disabled}
          onPrepare={onConfigure}
        />
      ) : null}
      {record.status !== 'imported' ? (
        <>
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
        </>
      ) : null}
      {record.status === 'ready' && record.sandboxId ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {translate('settings.sandbox.projects', 'Projects')}
          </summary>
          <SandboxProjectsPanel
            record={record}
            disabled={
              disabled || Boolean(record.verification && record.verification.outcome !== 'ready')
            }
          />
        </details>
      ) : null}
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

import { SandboxLifecyclePanel } from './SandboxLifecyclePanel'
import { SandboxProjectsPanel } from './SandboxProjectsPanel'
import { useState } from 'react'
import { SandboxAccessPanel } from './SandboxAccessPanel'
import { translate } from '@/i18n/i18n'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { sandboxPhaseCopy } from './sandbox-status-copy'

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
  return (
    <div className="space-y-2">
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
      {record.status === 'imported' ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {translate('settings.sandbox.projectsAndTools', 'Projects and tools')}
          </p>
          <p className="text-sm text-muted-foreground">
            {translate(
              'settings.sandbox.importNeedsVerification',
              'SSH access and required tools must be verified before linking projects. Importing does not configure the environment.'
            )}
          </p>
          <Button variant="outline" size="sm" disabled>
            {translate('settings.sandbox.verifyEnvironment', 'Verify environment')}
          </Button>
        </div>
      ) : (
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
      )}
      {record.status === 'ready' && record.sandboxId ? (
        <details>
          <summary className="cursor-pointer text-sm">
            {translate('settings.sandbox.projects', 'Projects')}
          </summary>
          <SandboxProjectsPanel record={record} disabled={disabled} />
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

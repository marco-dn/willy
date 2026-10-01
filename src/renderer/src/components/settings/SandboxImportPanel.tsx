import { useId, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { SandboxSummary } from '../../../../shared/sandbox-types'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export function SandboxImportPanel({
  sandbox,
  disabled,
  onImported
}: {
  sandbox: SandboxSummary
  disabled: boolean
  onImported: (record: ManagedSandbox) => void
}): React.JSX.Element {
  const id = useId()
  const mounted = useMountedRef()
  const active = useRef(false)
  const mounts = [...new Set(sandbox.workspaces)]
  const [selectedMount, setSelectedMount] = useState('')
  const mount = mounts.length === 1 ? mounts[0] : selectedMount
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const supported = sandbox.agent === 'shell' && mounts.length > 0
  const submit = async () => {
    if (active.current || disabled || !supported || !mounts.includes(mount)) {
      return
    }
    active.current = true
    setBusy(true)
    setError(undefined)
    try {
      const record = await window.api.sandboxes.importExisting({
        target: { name: sandbox.name, id: sandbox.id },
        mountPath: mount
      })
      onImported(record)
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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {translate('settings.sandbox.agent', 'Agent: {{agent}}', { agent: sandbox.agent })}
      </p>
      <p className="text-sm text-muted-foreground">
        {supported
          ? translate(
              'settings.sandbox.importNotice',
              'Register this sandbox in Willy without starting it or installing tools. SSH, network rules and shared files remain unchanged.'
            )
          : translate(
              'settings.sandbox.externalUnsupported',
              'Willy can manage only shell sandboxes with a shared folder.'
            )}
      </p>
      {supported && mounts.length > 1 ? (
        <div className="space-y-2">
          <Label htmlFor={id}>
            {translate('settings.sandbox.importMount', 'Shared folder to manage')}
          </Label>
          <Select
            value={selectedMount}
            onValueChange={setSelectedMount}
            disabled={disabled || busy}
          >
            <SelectTrigger id={id}>
              <SelectValue
                placeholder={translate('settings.sandbox.chooseMount', 'Choose a shared folder')}
              />
            </SelectTrigger>
            <SelectContent>
              {mounts.map((path) => (
                <SelectItem key={path} value={path}>
                  {path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {supported ? (
        <Button
          variant="outline"
          disabled={disabled || busy || !mounts.includes(mount)}
          onClick={() => void submit()}
        >
          {busy
            ? translate('settings.sandbox.importing', 'Importing…')
            : translate('settings.sandbox.manageInWilly', 'Manage in Willy')}
        </Button>
      ) : null}
    </div>
  )
}

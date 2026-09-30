import { useCallback, useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  SANDBOX_TOOLS,
  type ManagedSandbox,
  type SandboxProvisionRequest
} from '../../../../shared/sandbox-provisioning-types'
import type { SandboxSummary } from '../../../../shared/sandbox-types'
import { Button } from '../ui/button'
import { SandboxProvisionDialog } from './SandboxProvisionDialog'
import { SandboxProvisioningCard } from './SandboxProvisioningCard'

export function SandboxProvisioning({
  available,
  sandboxes
}: {
  available: boolean
  sandboxes: SandboxSummary[]
}): React.JSX.Element {
  const [records, setRecords] = useState<ManagedSandbox[]>([])
  const [error, setError] = useState<string>()
  const [loaded, setLoaded] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [request, setRequest] = useState<SandboxProvisionRequest>()
  const reload = useCallback(() => setRefresh((value) => value + 1), [])
  useEffect(() => {
    let stopped = false
    let inFlight = false
    const poll = async () => {
      if (stopped || inFlight) {
        return
      }
      inFlight = true
      try {
        const next = await window.api.sandboxes.listManaged()
        if (!stopped) {
          setRecords(next)
          setLoaded(true)
          setError(undefined)
        }
      } catch (error) {
        if (!stopped) {
          setError(String(error))
          setLoaded(false)
        }
      } finally {
        inFlight = false
      }
    }
    void poll()
    const timer = setInterval(() => {
      void poll()
    }, 2000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [refresh])
  const disabled =
    !available || !loaded || records.some((record) => record.status === 'provisioning')
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {translate('settings.sandbox.provisioning', 'Provisioning')}
      </p>
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        disabled={disabled}
        onClick={() =>
          setRequest({
            mode: 'create',
            name: '',
            mountPath: '',
            createMount: false,
            tools: [...SANDBOX_TOOLS]
          })
        }
      >
        {translate('settings.sandbox.create', 'Create sandbox')}
      </Button>
      {sandboxes
        .filter(
          (sandbox) =>
            sandbox.agent === 'shell' &&
            sandbox.workspaces.length > 0 &&
            !records.some((record) => record.name === sandbox.name)
        )
        .map((sandbox) => (
          <div key={sandbox.id}>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                setRequest({
                  mode: 'adopt',
                  name: sandbox.name,
                  sandboxId: sandbox.id,
                  mountPath: sandbox.workspaces[0],
                  createMount: false,
                  tools: [...SANDBOX_TOOLS]
                })
              }
            >
              {translate('settings.sandbox.adopt', 'Adopt {{name}}', { name: sandbox.name })}
            </Button>
          </div>
        ))}
      {records.map((record) => (
        <SandboxProvisioningCard
          key={record.name}
          record={record}
          disabled={disabled}
          onConfigure={() =>
            setRequest({
              mode: 'resume',
              name: record.name,
              mountPath: record.mountPath,
              sandboxId: record.sandboxId,
              createMount: false,
              tools: record.tools
            })
          }
        />
      ))}
      {request ? (
        <SandboxProvisionDialog
          initial={request}
          onClose={() => setRequest(undefined)}
          onSubmitted={reload}
        />
      ) : null}
    </div>
  )
}

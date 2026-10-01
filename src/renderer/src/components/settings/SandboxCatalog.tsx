import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  SANDBOX_TOOLS,
  type SandboxProvisionRequest
} from '../../../../shared/sandbox-provisioning-types'
import type { SandboxSummary } from '../../../../shared/sandbox-types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { SandboxProvisionForm } from './SandboxProvisionForm'
import { SandboxProvisioningCard } from './SandboxProvisioningCard'
import { useSandboxRecords } from './useSandboxRecords'
import {
  sandboxCatalogEntries,
  sandboxCatalogStateCopy,
  sandboxManagementCopy
} from './sandbox-catalog'

const noInventoryChange = () => {}
export function SandboxCatalog({
  available,
  sandboxes,
  revision = 0,
  onInventoryChange = noInventoryChange
}: {
  available: boolean
  sandboxes: SandboxSummary[]
  revision?: number
  onInventoryChange?: () => void
}): React.JSX.Element {
  const { records, setRecords, error, loaded, reload } = useSandboxRecords(
    revision,
    onInventoryChange
  )
  const [selected, setSelected] = useState<string>()
  const [request, setRequest] = useState<SandboxProvisionRequest>()
  const entries = sandboxCatalogEntries(sandboxes, records, available)
  const disabled =
    !available || !loaded || records.some((record) => record.status === 'provisioning')
  const back = () => {
    setSelected(undefined)
    setRequest(undefined)
  }
  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="break-all text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {request ? (
        <SandboxProvisionForm
          key={`${request.mode}:${request.name}`}
          initial={request}
          disabled={disabled}
          onClose={back}
          onSubmitted={(record) => {
            setRecords((previous) =>
              previous.filter((item) => item.name !== record.name).concat(record)
            )
            setSelected(`managed:${record.name}`)
            setRequest(undefined)
            reload()
            onInventoryChange()
          }}
        />
      ) : (
        <>
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
            {translate('settings.sandbox.newSandbox', 'New sandbox')}
          </Button>
          {!loaded && !error ? (
            <p role="status" className="text-sm text-muted-foreground">
              {translate('settings.sandbox.loadingRecords', 'Loading sandbox configuration…')}
            </p>
          ) : null}
          {loaded && available && !entries.length ? (
            <p className="text-sm text-muted-foreground">
              {translate('settings.sandbox.empty', 'No local sandboxes found.')}
            </p>
          ) : null}
          <ul
            className="space-y-3"
            aria-label={translate('settings.sandbox.list', 'Local sandboxes')}
          >
            {entries.map((item) => (
              <Collapsible
                key={item.key}
                open={selected === item.key}
                onOpenChange={(open) => setSelected(open ? item.key : undefined)}
                asChild
              >
                <li className="space-y-2 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="break-all text-sm font-medium">{item.name}</span>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{sandboxCatalogStateCopy(item.state)}</Badge>
                      <Badge variant="outline">{sandboxManagementCopy(item.record)}</Badge>
                    </div>
                  </div>
                  {item.mounts.map((mount) => (
                    <p key={mount} className="break-all font-mono text-xs">
                      {mount}
                    </p>
                  ))}
                  <CollapsibleTrigger asChild>
                    <Button
                      disabled={!loaded}
                      variant="outline"
                      size="sm"
                      aria-label={
                        selected === item.key
                          ? translate('settings.sandbox.closeNamed', 'Close {{name}} details', {
                              name: item.name
                            })
                          : translate('settings.sandbox.openNamed', 'Open {{name}}', {
                              name: item.name
                            })
                      }
                    >
                      {selected === item.key
                        ? translate('settings.sandbox.closeDetails', 'Close details')
                        : translate('settings.sandbox.openDetails', 'Open details')}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="pt-3">
                      {item.record ? (
                        <SandboxProvisioningCard
                          key={item.key}
                          record={item.record}
                          disabled={disabled}
                          onConfigure={() => {
                            const record = item.record
                            if (record) {
                              setRequest({
                                mode: 'resume',
                                name: record.name,
                                mountPath: record.mountPath,
                                sandboxId: record.sandboxId,
                                createMount: false,
                                tools: record.tools
                              })
                            }
                          }}
                        />
                      ) : item.observed ? (
                        <div className="space-y-3">
                          <p className="text-xs text-muted-foreground">
                            {translate('settings.sandbox.agent', 'Agent: {{agent}}', {
                              agent: item.observed.agent
                            })}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {item.observed.agent === 'shell' && item.mounts.length
                              ? translate(
                                  'settings.sandbox.externalAdoptionNotice',
                                  'This sandbox was created outside Willy. Adoption currently installs the required base and selected tools before enabling project management.'
                                )
                              : translate(
                                  'settings.sandbox.externalUnsupported',
                                  'Willy can manage only shell sandboxes with a shared folder.'
                                )}
                          </p>
                          {item.observed.agent === 'shell' && item.mounts.length > 0 ? (
                            <Button
                              variant="outline"
                              disabled={disabled}
                              onClick={() =>
                                setRequest({
                                  mode: 'adopt',
                                  name: item.name,
                                  sandboxId: item.observed?.id,
                                  mountPath: item.mounts[0],
                                  createMount: false,
                                  tools: [...SANDBOX_TOOLS]
                                })
                              }
                            >
                              {translate('settings.sandbox.adopt', 'Adopt {{name}}', {
                                name: item.name
                              })}
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </CollapsibleContent>
                </li>
              </Collapsible>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { createNonSecureContextUuid } from '../../../../shared/non-secure-context-uuid'
import { useMountedRef } from '@/hooks/useMountedRef'
import { translate } from '@/i18n/i18n'
import {
  SANDBOX_TOOLS,
  type SandboxProvisionRequest
} from '../../../../shared/sandbox-provisioning-types'
import type { SandboxSummary } from '../../../../shared/sandbox-types'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'
import { SandboxImportPanel } from './SandboxImportPanel'
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
  const mounted = useMountedRef()
  const [selected, setSelected] = useState<string>()
  const [request, setRequest] = useState<SandboxProvisionRequest>()
  const [githubSetup, setGithubSetup] = useState<{ name: string; sessionId: string }>()
  const entries = sandboxCatalogEntries(sandboxes, records, available)
  const groups = [
    {
      key: 'managed',
      title: translate('settings.sandbox.managedByWilly', 'Managed by Willy'),
      description: translate(
        'settings.sandbox.managedDescription',
        'Sandboxes registered in Willy.'
      ),
      entries: entries.filter((item) => item.record)
    },
    {
      key: 'external',
      title: translate('settings.sandbox.external', 'External'),
      description: translate(
        'settings.sandbox.externalDescription',
        'Sandboxes not yet managed by Willy. Import one to enable management.'
      ),
      entries: entries.filter((item) => !item.record)
    }
  ]
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
          onSubmitted={(record, configureGithub) => {
            if (configureGithub) {
              setGithubSetup({ name: record.name, sessionId: createNonSecureContextUuid() })
            }
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
          {groups
            .filter((group) => group.entries.length > 0)
            .map((group) => (
              <section
                key={group.key}
                aria-label={group.title}
                className="space-y-3 border-t border-border pt-4"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{group.title}</h3>
                  <Badge variant="secondary">{group.entries.length}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{group.description}</p>
                <ul className="space-y-3" aria-label={group.title}>
                  {group.entries.map((item) => (
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
                                ? translate(
                                    'settings.sandbox.closeNamed',
                                    'Close {{name}} details',
                                    {
                                      name: item.name
                                    }
                                  )
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
                                credentialSession={
                                  githubSetup?.name === item.name
                                    ? githubSetup.sessionId
                                    : undefined
                                }
                                onCredentialsClosed={() => setGithubSetup(undefined)}
                                onConfigure={() => {
                                  const record = item.record
                                  if (record) {
                                    setRequest({
                                      mode: 'resume',
                                      name: record.name,
                                      mountPath: record.mountPath,
                                      sandboxId: record.sandboxId,
                                      createMount: false,
                                      tools: record.tools,
                                      gitName: record.gitName,
                                      gitEmail: record.gitEmail
                                    })
                                  }
                                }}
                              />
                            ) : item.observed ? (
                              <SandboxImportPanel
                                sandbox={item.observed}
                                disabled={disabled}
                                onImported={(record) => {
                                  if (!mounted.current) {
                                    return
                                  }
                                  setRecords((previous) =>
                                    previous
                                      .filter((item) => item.name !== record.name)
                                      .concat(record)
                                  )
                                  setSelected((current) =>
                                    current === item.key ? `managed:${record.name}` : current
                                  )
                                  reload()
                                  onInventoryChange()
                                }}
                              />
                            ) : null}
                          </div>
                        </CollapsibleContent>
                      </li>
                    </Collapsible>
                  ))}
                </ul>
              </section>
            ))}
        </>
      )}
    </div>
  )
}

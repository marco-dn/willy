import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import type { SandboxSummary } from '../../../../shared/sandbox-types'
import { translate } from '@/i18n/i18n'
import { sandboxStatusCopy } from './sandbox-status-copy'

export type SandboxCatalogEntry = {
  key: string
  name: string
  mounts: string[]
  observed?: SandboxSummary
  record?: ManagedSandbox
  state: string
}

export function sandboxCatalogEntries(
  sandboxes: SandboxSummary[],
  records: ManagedSandbox[],
  available: boolean
): SandboxCatalogEntry[] {
  const remaining = new Map(sandboxes.map((sandbox) => [sandbox.id, sandbox]))
  const entries = records.map((record) => {
    const observed = record.sandboxId ? remaining.get(record.sandboxId) : undefined
    if (observed) {
      remaining.delete(observed.id)
    }
    return {
      key: `managed:${record.name}`,
      name: record.name,
      mounts: observed?.workspaces ?? [record.mountPath],
      observed,
      record,
      state: !available
        ? 'unavailable'
        : (observed?.status.toLowerCase() ?? (record.sandboxId ? 'missing' : 'uncreated'))
    }
  })
  return [
    ...entries,
    ...Array.from(remaining.values(), (observed) => ({
      key: `external:${observed.id}`,
      name: observed.name,
      mounts: observed.workspaces,
      observed,
      state: available ? observed.status.toLowerCase() : 'unavailable'
    }))
  ].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

export function sandboxManagementCopy(record?: ManagedSandbox): string {
  if (!record) {
    return translate('settings.sandbox.external', 'External')
  }
  if (record.status === 'imported') {
    return translate('settings.sandbox.needsVerification', 'Verification required')
  }
  if (record.status === 'ready') {
    return translate('settings.sandbox.configured', 'Configured')
  }
  if (record.status === 'provisioning') {
    return translate('settings.sandbox.preparing', 'Preparing')
  }
  return translate('settings.sandbox.preparationInterrupted', 'Preparation interrupted')
}

export function sandboxCatalogStateCopy(state: string): string {
  if (state === 'unavailable') {
    return translate('settings.sandbox.stateUnavailable', 'State unavailable')
  }
  if (state === 'missing') {
    return translate('settings.sandbox.stateMissing', 'Removed outside Willy')
  }
  if (state === 'uncreated') {
    return translate('settings.sandbox.notCreated', 'Not created yet')
  }
  return sandboxStatusCopy(state)
}

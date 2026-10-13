import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SshTarget } from '../../shared/ssh-types'
import { createSandboxCommand } from './sandbox-command'
import { parseSbxInventory } from './sbx-response'

let records: () => ManagedSandbox[] = () => []
export function configureSandboxLifecycleGuard(read: () => ManagedSandbox[]): void {
  records = read
}
export function assertSandboxLifecycleAllowsExecution(sandboxId: string): void {
  const record = records().find((entry) => entry.sandboxId === sandboxId)
  if (record?.lifecycle && (record.lifecycle.desired !== 'running' || record.lifecycle.pending)) {
    throw new Error(
      'This sandbox was stopped or is changing state. Start it from Settings → Sandbox before continuing.'
    )
  }
}
export async function assertSandboxSshConnectionAllowed(
  target: Pick<SshTarget, 'id' | 'host' | 'configHost'>
): Promise<void> {
  const matches = records().filter(
    (record) =>
      record.sshTargetId === target.id ||
      (target.configHost ?? target.host) === `${record.name}.sbx`
  )
  if (!matches.length) {
    return
  }
  for (const record of matches) {
    if (
      record.lifecycle?.desired === 'stopped' ||
      record.lifecycle?.desired === 'removed' ||
      record.lifecycle?.pending === 'stop' ||
      record.lifecycle?.pending === 'remove'
    ) {
      throw new Error(
        `Sandbox ${record.name} is stopped or removed. Start it from Settings → Sandbox.`
      )
    }
  }
  const run = await createSandboxCommand()
  const inventory = parseSbxInventory(await run(['ls', '--json'])).sandboxes
  for (const record of matches) {
    const observed = inventory.find(
      (entry) => entry.id === record.sandboxId && entry.name === record.name
    )
    if (
      !observed ||
      observed.status.toLowerCase() !== 'running' ||
      !observed.workspaces.includes(record.mountPath)
    ) {
      throw new Error(
        `Sandbox ${record.name} is unavailable. Start it from Settings → Sandbox; SSH will not start it automatically.`
      )
    }
    // Stop intent may have changed while the inventory request was in flight.
    assertSandboxLifecycleAllowsExecution(record.sandboxId ?? '')
  }
}

export async function isSandboxSshTargetConfirmedRemoved(
  target: Pick<SshTarget, 'id' | 'host' | 'configHost'>
): Promise<boolean> {
  const matches = records().filter((record) => record.sshTargetId === target.id)
  const record = matches.length === 1 ? matches[0] : undefined
  if (
    !record?.sandboxId ||
    (target.configHost ?? target.host) !== `${record.name}.sbx` ||
    record.lifecycle?.desired !== 'removed' ||
    record.lifecycle.pending ||
    record.lifecycle.error
  ) {
    return false
  }
  const run = await createSandboxCommand()
  const inventory = parseSbxInventory(await run(['ls', '--json'])).sandboxes
  return !inventory.some((entry) => entry.id === record.sandboxId || entry.name === record.name)
}

import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SandboxCommand } from './sandbox-command'
import { cleanupProvisioningNetwork } from './sandbox-network'
type RecoveryDependencies = {
  list(): ManagedSandbox[]
  save(record: ManagedSandbox): void
  command(): Promise<SandboxCommand>
  verify(record: ManagedSandbox, run: SandboxCommand): Promise<void>
}
export async function recoverSandboxProvisioningRecords(deps: RecoveryDependencies): Promise<void> {
  for (const record of deps.list()) {
    if (record.status !== 'provisioning' && !record.network) {
      continue
    }
    record.status = 'interrupted'
    record.error =
      'Provisioning was interrupted. Remote work may still be running. Resume when it has finished.'
    deps.save(record)
    if (!record.network) {
      continue
    }
    try {
      const run = await deps.command()
      await deps.verify(record, run)
      await cleanupProvisioningNetwork(run, record, () => deps.save(record))
    } catch (error) {
      record.error =
        error instanceof Error ? error.message : 'Temporary network cleanup is incomplete.'
    }
    deps.save(record)
  }
}

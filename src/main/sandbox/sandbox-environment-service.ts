import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type {
  SandboxEnvironmentCheck,
  SandboxEnvironmentReport
} from '../../shared/sandbox-environment-types'
import type { SandboxAccess } from './sandbox-command'
import type { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { SandboxSshConfigurationError } from './sandbox-ssh-target'
import { sandboxTargetSchema } from './sandbox-policy-response'
import { parseSbxInventory } from './sbx-response'
import { parseSandboxEnvironmentProbe, sandboxEnvironmentProbe } from './sandbox-environment-probe'

type Dependencies = {
  records: SandboxProvisioningStore
  acquire(target: unknown): Promise<SandboxAccess>
  inspectSsh(alias: string, previousId?: string): Promise<unknown>
  ssh(alias: string, script: string): Promise<string>
  relay(checks: SandboxEnvironmentCheck[]): SandboxEnvironmentCheck
  registerTarget(alias: string, previousId?: string): Promise<string>
  changed(): void
}
export class SandboxEnvironmentService {
  constructor(private readonly deps: Dependencies) {}
  async verify(input: unknown): Promise<SandboxEnvironmentReport> {
    const target = sandboxTargetSchema.parse(input)
    const access = await this.deps.acquire(target)
    try {
      const record = this.deps.records
        .list()
        .find((entry) => entry.sandboxId === target.id && entry.name === target.name)
      if (!record) {
        throw new Error('Sandbox management record not found.')
      }
      let report: SandboxEnvironmentReport
      const checks: SandboxEnvironmentCheck[] = []
      let phase = 'sandbox'
      try {
        const observe = async () => {
          const found = parseSbxInventory(await access.run(['ls', '--json'])).sandboxes.find(
            (item) => item.id === target.id
          )
          if (
            !found ||
            found.name !== target.name ||
            found.agent !== 'shell' ||
            !found.workspaces.includes(record.mountPath)
          ) {
            throw new Error(
              'Sandbox identity or shared folder changed. No preparation was started.'
            )
          }
          if (
            found.status.toLowerCase() !== 'running' ||
            (record.lifecycle &&
              (record.lifecycle.desired !== 'running' || record.lifecycle.pending))
          ) {
            throw new Error(
              'Start the sandbox from its lifecycle controls before verifying the environment.'
            )
          }
        }
        await observe()
        checks.push({
          id: 'sandbox',
          status: 'ok',
          detail: 'Running sandbox identity and mount verified.'
        })
        phase = 'ssh'
        const alias = `${record.name}.sbx`
        await this.deps.inspectSsh(alias, record.sshTargetId)
        await observe()
        const output = await this.deps.ssh(
          alias,
          sandboxEnvironmentProbe(target.id, record.mountPath, record.tools)
        )
        checks.push({
          id: 'ssh',
          status: 'ok',
          detail: 'SSH command completed without installing tools.'
        })
        phase = 'probe'
        const observedChecks = parseSandboxEnvironmentProbe(output, record.tools)
        checks.push(...observedChecks)
        const identity = observedChecks.find((check) => check.id === 'identity')
        if (identity?.status === 'ok' && identity.detail !== target.id) {
          identity.status = 'error'
          identity.detail = 'The SSH host reported a different sandbox UUID.'
        }
        if (
          checks.every(
            (check) => !['identity', 'mount'].includes(check.id) || check.status === 'ok'
          )
        ) {
          checks.push(this.deps.relay(checks))
        }
        await observe()
        const failures = checks.filter((check) => check.status !== 'ok')
        const repairable =
          failures.length > 0 &&
          failures.every(
            (check) =>
              !['identity', 'mount', 'libc', 'platform', 'flock'].includes(check.id) &&
              (check.id !== 'relay' || check.status === 'missing')
          )
        report = {
          checkedAt: Date.now(),
          outcome: failures.length ? (repairable ? 'needs-preparation' : 'unavailable') : 'ready',
          canPrepare: repairable,
          checks
        }
        if (report.outcome === 'ready') {
          phase = 'ssh-registration'
          const sshTargetId = await this.deps.registerTarget(alias, record.sshTargetId)
          await observe()
          record.sshTargetId = sshTargetId
          record.status = 'ready'
          record.error = undefined
          record.versions = observedChecks
            .filter((check) => !['identity', 'mount', 'platform', 'libc'].includes(check.id))
            .map((check) => `${check.id} ${check.detail}`)
        }
      } catch (error) {
        const missingSsh = error instanceof SandboxSshConfigurationError && error.kind === 'missing'
        checks.push({
          id: phase,
          status: missingSsh ? 'missing' : 'error',
          detail: (error instanceof Error ? error.message : String(error)).slice(0, 2000)
        })
        report = {
          checkedAt: Date.now(),
          outcome: missingSsh ? 'needs-preparation' : 'unavailable',
          canPrepare: missingSsh,
          checks
        }
      }
      this.save(record, report)
      return report
    } finally {
      access.release()
    }
  }
  private save(record: ManagedSandbox, report: SandboxEnvironmentReport): void {
    record.verification = report
    record.updatedAt = report.checkedAt
    this.deps.records.save(record)
    this.deps.changed()
  }
}

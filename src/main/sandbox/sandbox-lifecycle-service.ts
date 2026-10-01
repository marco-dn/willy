import { z } from 'zod'
import type { Store } from '../persistence'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type {
  SandboxLifecycleSnapshot,
  SandboxLifecycleState
} from '../../shared/sandbox-lifecycle-types'
import type { SandboxProvisioningStore } from './sandbox-provisioning-store'
import type { SandboxAccess, SandboxCommand } from './sandbox-command'
import type { SandboxExecutionPolicy } from './sandbox-execution-policy'
import { sandboxTargetSchema } from './sandbox-policy-response'
import { parseSbxInventory } from './sbx-response'
import { getRepoExecutionHostId } from '../../shared/execution-host'

const requestSchema = z
  .object({
    target: sandboxTargetSchema,
    action: z.enum(['start', 'stop', 'remove']),
    confirmedProjectIds: z.array(z.string()).max(10000).optional(),
    confirmName: z.string().optional()
  })
  .strict()
type Dependencies = {
  records: SandboxProvisioningStore
  store: Pick<Store, 'getProjects' | 'getRepos'>
  command(): Promise<SandboxCommand>
  acquire(target: unknown): Promise<SandboxAccess>
  policy: SandboxExecutionPolicy
  targetIds(record: ManagedSandbox): string[]
  disconnect(id: string): Promise<void>
  connect(id: string): Promise<void>
  changed(): void
}
export class SandboxLifecycleService {
  constructor(private readonly deps: Dependencies) {}
  private record(input: unknown): ManagedSandbox {
    const target = sandboxTargetSchema.parse(input)
    const record = this.deps.records
      .list()
      .find((entry) => entry.name === target.name && entry.sandboxId === target.id)
    if (!record) {
      throw new Error('Sandbox management record not found. Refresh Settings.')
    }
    return record
  }
  private projects(record: ManagedSandbox): SandboxLifecycleSnapshot['projects'] {
    const hosts = new Set(this.deps.targetIds(record).map((id) => `ssh:${id}`))
    const repoIds = new Set(
      this.deps.store
        .getRepos()
        .filter((repo) => hosts.has(getRepoExecutionHostId(repo)))
        .map((repo) => repo.id)
    )
    return this.deps.store
      .getProjects()
      .filter(
        (project) =>
          project.sandboxBinding?.sandboxId === record.sandboxId ||
          project.sourceRepoIds.some((id) => repoIds.has(id))
      )
      .map((project) => ({
        id: project.id,
        name: project.displayName,
        linked: project.sandboxBinding?.sandboxId === record.sandboxId
      }))
  }
  private async observed(
    record: ManagedSandbox,
    run: SandboxCommand
  ): Promise<SandboxLifecycleSnapshot['state']> {
    const inventory = parseSbxInventory(await run(['ls', '--json'])).sandboxes
    const found = inventory.find((entry) => entry.id === record.sandboxId)
    if (!found) {
      if (inventory.some((entry) => entry.name === record.name)) {
        throw new Error('A different sandbox now uses this name. No changes were made.')
      }
      return 'missing'
    }
    if (
      found.name !== record.name ||
      found.agent !== 'shell' ||
      !found.workspaces.includes(record.mountPath)
    ) {
      throw new Error('Sandbox identity or shared folder changed. No changes were made.')
    }
    const state = found.status.toLowerCase()
    return state === 'running' || state === 'stopped' ? state : 'unavailable'
  }
  async snapshot(input: unknown): Promise<SandboxLifecycleSnapshot> {
    const record = this.record(input)
    return {
      state: await this.observed(record, await this.deps.command()),
      projects: this.projects(record),
      lifecycle: record.lifecycle
    }
  }
  private save(record: ManagedSandbox, lifecycle: SandboxLifecycleState): void {
    record.lifecycle = lifecycle
    record.updatedAt = Date.now()
    this.deps.records.save(record)
    this.deps.changed()
  }
  async execute(input: unknown): Promise<void> {
    const request = requestSchema.parse(input)
    const access = await this.deps.acquire(request.target)
    try {
      const record = this.record(request.target)
      const projects = this.projects(record)
      if (request.action !== 'start') {
        const confirmed = new Set(request.confirmedProjectIds)
        if (
          !request.confirmedProjectIds ||
          confirmed.size !== projects.length ||
          projects.some((project) => !confirmed.has(project.id))
        ) {
          throw new Error('The affected projects changed. Review the confirmation again.')
        }
      }
      if (
        request.action === 'remove' &&
        (projects.some((project) => project.linked) || request.confirmName !== record.name)
      ) {
        throw new Error('Unlink all projects and confirm the sandbox name before removal.')
      }
      const transition = (index: number): Promise<void> =>
        index < projects.length
          ? this.deps.policy.transition(projects[index].id, () => transition(index + 1))
          : this.perform(record, request.action, access.run)
      await transition(0)
    } finally {
      access.release()
    }
  }
  private async perform(
    record: ManagedSandbox,
    action: 'start' | 'stop' | 'remove',
    run: SandboxCommand
  ): Promise<void> {
    if (!record.sandboxId) {
      throw new Error('Sandbox identity is missing.')
    }
    const observed = await this.observed(record, run)
    if (observed === 'unavailable' || (observed === 'missing' && action !== 'remove')) {
      throw new Error('Sandbox is unavailable or missing. No operation was started.')
    }
    const desired = action === 'start' ? 'running' : action === 'stop' ? 'stopped' : 'removed'
    this.save(record, { desired, pending: action })
    try {
      if (action !== 'start') {
        for (const targetId of this.deps.targetIds(record)) {
          await this.deps.disconnect(targetId)
        }
      }
      const current = await this.observed(record, run)
      if (current === 'unavailable' || (current === 'missing' && action !== 'remove')) {
        throw new Error('Sandbox changed while preparing the operation. Refresh and retry.')
      }
      if (action === 'start' && current !== 'running') {
        // exec starts an existing sandbox without creating a replacement or an interactive agent.
        await run(['exec', record.name, '/bin/true'])
      } else if (action === 'stop' && current !== 'stopped') {
        await run(['stop', record.name])
      } else if (action === 'remove' && current !== 'missing') {
        await run(['rm', '--force', record.name])
      }
      const after = await this.observed(record, run)
      if (after !== (action === 'start' ? 'running' : action === 'stop' ? 'stopped' : 'missing')) {
        throw new Error(
          'The requested state is not confirmed yet. Refresh and retry; remote sessions may still be running.'
        )
      }
      // Keep SSH targets and repository history: they can be reused by unlinked projects.
      this.save(record, { desired })
      if (action === 'start' && record.sshTargetId) {
        await this.deps.connect(record.sshTargetId)
      }
    } catch (error) {
      this.save(record, {
        desired,
        pending: action,
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }
}

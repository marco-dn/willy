import { recoverSandboxProvisioningRecords } from './sandbox-provisioning-recovery'
import { sandboxTargetSchema } from './sandbox-policy-response'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { ManagedSandbox, SandboxProvisionStage } from '../../shared/sandbox-provisioning-types'
import type { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { provisionRequestSchema } from './sandbox-provisioning-store'
import {
  createSandboxCommand,
  runSandboxSsh,
  type SandboxCommand,
  type SandboxAccess
} from './sandbox-command'
import { parseSbxInventory } from './sbx-response'
import { cleanupProvisioningNetwork, openProvisioningNetwork } from './sandbox-network'
import {
  baseInstaller,
  sandboxScript,
  toolInstaller,
  verificationScript,
  verifiedSandboxVersions
} from './sandbox-installers'

type Dependencies = {
  command: () => Promise<SandboxCommand>
  ssh: typeof runSandboxSsh
  registerTarget: (alias: string, previousId?: string) => Promise<string>
  connectTarget: (id: string) => Promise<void>
}
export class SandboxProvisioningManager {
  private busy = false
  private persistenceError: Error | undefined
  private recovery: Promise<void>
  constructor(
    private store: SandboxProvisioningStore,
    private dependencies: Dependencies
  ) {
    this.recovery = this.recover()
  }
  async list(): Promise<ManagedSandbox[]> {
    await this.recovery
    if (this.persistenceError) {
      throw this.persistenceError
    }
    return this.store
      .list()
      .filter(
        (record) =>
          record.lifecycle?.desired !== 'removed' ||
          record.lifecycle.pending ||
          record.lifecycle.error
      )
  }
  async acquireSandbox(
    input: unknown,
    options?: { skipInspection: boolean }
  ): Promise<SandboxAccess> {
    await this.recovery
    if (this.persistenceError) {
      throw this.persistenceError
    }
    if (this.busy) {
      throw new Error('Another sandbox operation is running. Wait for it to finish.')
    }
    this.busy = true
    try {
      const target = sandboxTargetSchema.parse(input)
      const record = this.store
        .list()
        .find((record) => record.name === target.name && record.sandboxId === target.id)
      if (!record) {
        throw new Error('This sandbox is not managed or its identity changed. Refresh settings.')
      }
      if (record.network) {
        throw new Error('Resume provisioning to finish temporary network cleanup first.')
      }
      const run = await this.dependencies.command()
      if (!options?.skipInspection) {
        if (
          record.lifecycle &&
          (record.lifecycle.desired !== 'running' || record.lifecycle.pending)
        ) {
          throw new Error('Start the sandbox from Settings before performing other operations.')
        }
        await this.verifyIdentity(record, run)
      }
      let released = false
      return {
        run,
        release: () => {
          if (!released) {
            released = true
            this.busy = false
          }
        }
      }
    } catch (error) {
      this.busy = false
      throw error
    }
  }
  async provision(input: unknown): Promise<ManagedSandbox> {
    await this.recovery
    if (this.persistenceError) {
      throw this.persistenceError
    }
    if (this.busy) {
      throw new Error('Another sandbox operation is running. Wait for it to finish.')
    }
    this.busy = true
    try {
      const request = provisionRequestSchema.parse(input)
      if (request.name === 'default') {
        throw new Error('Choose a sandbox name other than default.')
      }
      const existing = this.store.list().find((record) => record.name === request.name)
      if (request.mode === 'resume' && !existing) {
        throw new Error('No saved operation to resume.')
      }
      if (request.mode !== 'resume' && existing) {
        throw new Error('This sandbox is already managed. Use Resume / configure.')
      }
      const expanded =
        request.mountPath.startsWith('~/') || request.mountPath.startsWith('~\\')
          ? join(homedir(), request.mountPath.slice(2))
          : request.mountPath
      if (!isAbsolute(expanded)) {
        throw new Error('The shared folder must be an absolute host path.')
      }
      const run = await this.dependencies.command()
      const inventory = parseSbxInventory(await run(['ls', '--json'])).sandboxes
      const found = inventory.find((item) => item.name === request.name)
      if (request.mode === 'create' && found) {
        throw new Error('This name already exists. Adopt that sandbox instead.')
      }
      if (request.mode === 'adopt' && (!found || found.id !== request.sandboxId)) {
        throw new Error('The sandbox changed. Refresh before adopting it.')
      }
      if (request.createMount && request.mode === 'create') {
        await mkdir(expanded, { recursive: true })
      }
      const mountPath = await realpath(expanded)
      if (!(await stat(mountPath)).isDirectory()) {
        throw new Error('The shared folder must be a directory.')
      }
      if (existing && existing.mountPath !== mountPath) {
        throw new Error('The saved shared folder cannot be changed during resume.')
      }
      if (found && (found.agent !== 'shell' || !found.workspaces.includes(mountPath))) {
        throw new Error('Only shell sandboxes with this exact shared folder can be adopted.')
      }
      if (existing?.sandboxId && found?.id !== existing.sandboxId) {
        throw new Error(
          'The saved sandbox is missing or has been replaced. It will not be recreated.'
        )
      }
      if (existing?.lifecycle && existing.lifecycle.desired !== 'running') {
        throw new Error('Start the sandbox from Settings before resuming provisioning.')
      }
      const record: ManagedSandbox = {
        ...existing,
        name: request.name,
        mountPath,
        sandboxId: existing?.sandboxId ?? found?.id,
        tools: [...new Set(request.tools)],
        operationId: randomUUID(),
        status: 'provisioning',
        stage: 'sandbox',
        updatedAt: Date.now(),
        logs: [],
        versions: [],
        error: undefined
      }
      this.store.save(record)
      void this.execute(record, run)
        .finally(() => {
          this.busy = false
        })
        .catch((error: unknown) => {
          this.persistenceError = new Error(
            `Could not save sandbox progress. Restart Willy after fixing storage: ${String(error)}`
          )
        })
      return structuredClone(record)
    } catch (error) {
      this.busy = false
      throw error
    }
  }
  private save(record: ManagedSandbox): void {
    record.updatedAt = Date.now()
    this.store.save(record)
  }
  private stage(record: ManagedSandbox, stage: SandboxProvisionStage): void {
    record.stage = stage
    record.logs = [...record.logs, `${new Date().toISOString()} ${stage}`].slice(-80)
    this.save(record)
  }
  private async verifyIdentity(record: ManagedSandbox, run: SandboxCommand): Promise<void> {
    const found = parseSbxInventory(await run(['ls', '--json'])).sandboxes.find(
      (item) => item.name === record.name
    )
    if (
      !found ||
      found.agent !== 'shell' ||
      !found.workspaces.includes(record.mountPath) ||
      (record.sandboxId && found.id !== record.sandboxId)
    ) {
      throw new Error('Sandbox identity or shared folder changed. No further changes were made.')
    }
    record.sandboxId = found.id
    this.save(record)
  }
  private async execute(record: ManagedSandbox, run: SandboxCommand): Promise<void> {
    let failure: string | undefined
    try {
      if (!record.sandboxId) {
        await run(['create', '--name', record.name, 'shell', record.mountPath])
      }
      await this.verifyIdentity(record, run)
      await cleanupProvisioningNetwork(run, record, () => this.save(record))
      this.stage(record, 'ssh')
      await run(['setup', 'ssh'])
      const bootId = (
        await run(['exec', record.name, 'cat', '/proc/sys/kernel/random/boot_id'])
      ).trim()
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(bootId)) {
        throw new Error('Could not verify the Linux sandbox identity through sbx exec.')
      }
      const alias = `${record.name}.sbx`
      const remote = async (body: string) => {
        const output = await this.dependencies.ssh(
          alias,
          sandboxScript(body, record.mountPath, bootId)
        )
        record.logs = [
          ...record.logs,
          ...output
            .split('\n')
            .filter(Boolean)
            .map((line) => line.slice(0, 300))
        ].slice(-80)
        this.save(record)
        return output
      }
      await remote('true')
      this.stage(record, 'network')
      await openProvisioningNetwork(run, record, () => this.save(record))
      this.stage(record, 'base')
      await remote(baseInstaller)
      for (const tool of record.tools) {
        this.stage(record, tool)
        await remote(toolInstaller(tool))
      }
      this.stage(record, 'verify')
      const output = await remote(verificationScript(record.tools))
      record.versions = verifiedSandboxVersions(output, record.tools)
      this.save(record)
      this.stage(record, 'connect')
      record.sshTargetId = await this.dependencies.registerTarget(alias, record.sshTargetId)
      this.save(record)
      await this.dependencies.connectTarget(record.sshTargetId)
    } catch (error) {
      failure =
        `${record.stage}: ${error instanceof Error ? error.message : 'Provisioning failed'}`.slice(
          0,
          4000
        )
    }
    try {
      this.stage(record, 'cleanup')
      if (record.network) {
        await this.verifyIdentity(record, run)
        await cleanupProvisioningNetwork(run, record, () => this.save(record))
      }
    } catch (error) {
      failure = [
        failure,
        error instanceof Error ? error.message : 'Temporary network cleanup failed'
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 6000)
    }
    record.status = failure ? 'error' : 'ready'
    record.error = failure
    this.save(record)
  }
  private recover(): Promise<void> {
    return recoverSandboxProvisioningRecords({
      list: () => this.store.list(),
      save: (record) => this.save(record),
      command: () => this.dependencies.command(),
      verify: (record, run) => this.verifyIdentity(record, run)
    })
  }
}
export const defaultSandboxCommands = { command: createSandboxCommand, ssh: runSandboxSsh }

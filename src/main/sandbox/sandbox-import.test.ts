import { SandboxEnvironmentService } from './sandbox-environment-service'
import { SANDBOX_BASE_TOOLS } from './sandbox-installers'
import { SandboxLifecycleService } from './sandbox-lifecycle-service'
import { SandboxExecutionPolicy } from './sandbox-execution-policy'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SandboxSummary } from '../../shared/sandbox-types'
import { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { SandboxProvisioningManager } from './sandbox-provisioning-manager'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'willy-import-'))
  directories.push(directory)
  const mount = join(directory, 'shared folder')
  mkdirSync(mount)
  const file = join(directory, 'state.json')
  const store = new SandboxProvisioningStore(file)
  let inventory: SandboxSummary[] = [
    {
      name: 'external-demo',
      id: 'external-id',
      agent: 'shell',
      status: 'stopped',
      workspaces: [mount]
    }
  ]
  const run = vi.fn(async (_args: string[]) => JSON.stringify({ sandboxes: inventory }))
  const dependencies = {
    command: vi.fn(async () => run),
    ssh: vi.fn(),
    registerTarget: vi.fn(),
    connectTarget: vi.fn()
  }
  const manager = new SandboxProvisioningManager(store, dependencies)
  const request = { target: { name: 'external-demo', id: 'external-id' }, mountPath: mount }
  return {
    directory,
    mount,
    file,
    store,
    run,
    dependencies,
    manager,
    request,
    setInventory: (next: SandboxSummary[]) => {
      inventory = next
    },
    inventory: () => inventory
  }
}
describe('sandbox import without preparation', () => {
  it('persists an unprepared registration using only inventory reads and leaves the guest stopped', async () => {
    const f = fixture()
    const result = await f.manager.importExisting(f.request)
    expect(result).toMatchObject({
      status: 'imported',
      sandboxId: 'external-id',
      mountPath: f.mount,
      tools: [],
      versions: []
    })
    expect(result.sshTargetId).toBeUndefined()
    expect(result.network).toBeUndefined()
    expect(
      f.run.mock.calls.every(([args]) => JSON.stringify(args) === JSON.stringify(['ls', '--json']))
    ).toBe(true)
    expect(f.dependencies.ssh).not.toHaveBeenCalled()
    expect(f.dependencies.registerTarget).not.toHaveBeenCalled()
    expect(f.dependencies.connectTarget).not.toHaveBeenCalled()
    const reopened = new SandboxProvisioningManager(
      new SandboxProvisioningStore(f.file),
      f.dependencies
    )
    expect(await reopened.list()).toEqual([result])
    expect(f.inventory()[0].status).toBe('stopped')
  })
  it('supports lifecycle after import without requiring or configuring SSH', async () => {
    const f = fixture()
    await f.manager.importExisting(f.request)
    f.run.mockImplementation(async (args) => {
      if (args[0] === 'exec') {
        f.setInventory([{ ...f.inventory()[0], status: 'running' }])
      }
      if (args[0] === 'stop') {
        f.setInventory([{ ...f.inventory()[0], status: 'stopped' }])
      }
      if (args[0] === 'rm') {
        f.setInventory([])
      }
      return JSON.stringify({ sandboxes: f.inventory() })
    })
    const service = new SandboxLifecycleService({
      records: f.store,
      store: { getProjects: () => [], getRepos: () => [] },
      command: f.dependencies.command,
      acquire: (target) => f.manager.acquireSandbox(target, { skipInspection: true }),
      policy: new SandboxExecutionPolicy({ projects: () => [], available: async () => {} }),
      targetIds: () => [],
      disconnect: vi.fn(),
      connect: f.dependencies.connectTarget,
      changed: vi.fn()
    })
    await service.execute({ target: f.request.target, action: 'start' })
    expect((await service.snapshot(f.request.target)).state).toBe('running')
    await service.execute({ target: f.request.target, action: 'stop', confirmedProjectIds: [] })
    expect((await service.snapshot(f.request.target)).state).toBe('stopped')
    await service.execute({
      target: f.request.target,
      action: 'remove',
      confirmedProjectIds: [],
      confirmName: f.request.target.name
    })
    expect(await f.manager.list()).toEqual([])
    expect(existsSync(f.mount)).toBe(true)
    expect(f.dependencies.connectTarget).not.toHaveBeenCalled()
    expect(f.dependencies.ssh).not.toHaveBeenCalled()
  })
  it('rejects provisioning options and missing directories without creating anything', async () => {
    const f = fixture()
    await expect(f.manager.importExisting({ ...f.request, tools: ['uv'] })).rejects.toThrow()
    const missing = join(f.directory, 'missing')
    f.setInventory([{ ...f.inventory()[0], workspaces: [missing] }])
    await expect(f.manager.importExisting({ ...f.request, mountPath: missing })).rejects.toThrow()
    expect(existsSync(missing)).toBe(false)
    expect(f.store.list()).toEqual([])
  })
  it('is idempotent for the same UUID and mount, preserving prior lifecycle intent', async () => {
    const f = fixture()
    const record = await f.manager.importExisting(f.request)
    f.store.save({ ...record, lifecycle: { desired: 'stopped' } })
    expect(await f.manager.importExisting(f.request)).toEqual(f.store.list()[0])
    expect(f.store.list()).toHaveLength(1)
    expect(f.store.list()[0].operationId).toBe(record.operationId)
  })
  it('imports the explicitly selected second mount', async () => {
    const f = fixture()
    const second = join(f.directory, 'second folder')
    mkdirSync(second)
    f.setInventory([{ ...f.inventory()[0], workspaces: [f.mount, second] }])
    expect((await f.manager.importExisting({ ...f.request, mountPath: second })).mountPath).toBe(
      second
    )
    await expect(f.manager.importExisting(f.request)).rejects.toThrow(
      'conflicting management record'
    )
    expect(f.store.list()[0].mountPath).toBe(second)
  })
  it.each(['identity', 'agent', 'mount', 'removed'])(
    'rejects a stale or unsupported %s',
    async (kind) => {
      const f = fixture()
      const sandbox = f.inventory()[0]
      f.setInventory(
        kind === 'removed'
          ? []
          : [
              {
                ...sandbox,
                ...(kind === 'identity' ? { id: 'replacement' } : {}),
                ...(kind === 'agent' ? { agent: 'claude' } : {}),
                ...(kind === 'mount' ? { workspaces: [f.directory] } : {})
              }
            ]
      )
      await expect(f.manager.importExisting(f.request)).rejects.toThrow(
        'identity or shared folder changed'
      )
      expect(f.store.list()).toEqual([])
    }
  )
  it('rechecks identity before persisting and does not overwrite another saved UUID', async () => {
    const f = fixture()
    f.run
      .mockResolvedValueOnce(JSON.stringify({ sandboxes: f.inventory() }))
      .mockResolvedValueOnce(JSON.stringify({ sandboxes: [] }))
    await expect(f.manager.importExisting(f.request)).rejects.toThrow('identity')
    expect(f.store.list()).toEqual([])
    const record = await f.manager.importExisting(f.request)
    f.setInventory([{ ...f.inventory()[0], id: 'replacement' }])
    await expect(
      f.manager.importExisting({ ...f.request, target: { ...f.request.target, id: 'replacement' } })
    ).rejects.toThrow('name already belongs')
    expect(f.store.list()).toEqual([record])
  })
  it('rejects relative, unreported and non-directory mounts without creating folders', async () => {
    const f = fixture()
    await expect(f.manager.importExisting({ ...f.request, mountPath: 'relative' })).rejects.toThrow(
      'absolute'
    )
    expect(f.dependencies.command).not.toHaveBeenCalled()
    await expect(
      f.manager.importExisting({ ...f.request, mountPath: f.directory })
    ).rejects.toThrow('shared folder')
    const file = join(f.directory, 'not-a-folder')
    writeFileSync(file, 'untouched')
    f.setInventory([{ ...f.inventory()[0], workspaces: [file] }])
    await expect(f.manager.importExisting({ ...f.request, mountPath: file })).rejects.toThrow(
      'directory'
    )
    expect(f.store.list()).toEqual([])
  })
  it('shares the operation lock with import, provisioning and lifecycle, and releases it on error', async () => {
    const f = fixture()
    const gate = Promise.withResolvers<string>()
    f.run.mockReturnValueOnce(gate.promise)
    const pending = f.manager.importExisting(f.request)
    await vi.waitFor(() => expect(f.run).toHaveBeenCalledOnce())
    await expect(f.manager.importExisting(f.request)).rejects.toThrow('Another sandbox operation')
    await expect(f.manager.provision({})).rejects.toThrow('Another sandbox operation')
    await expect(
      f.manager.acquireSandbox(f.request.target, { skipInspection: true })
    ).rejects.toThrow('Another sandbox operation')
    gate.reject(new Error('Daemon unavailable'))
    await expect(pending).rejects.toThrow('Daemon unavailable')
    expect(f.store.list()).toEqual([])
    const record = await f.manager.importExisting(f.request)
    const access = await f.manager.acquireSandbox(f.request.target, { skipInspection: true })
    await expect(f.manager.importExisting(f.request)).rejects.toThrow('Another sandbox operation')
    access.release()
    expect(await f.manager.importExisting(f.request)).toEqual(record)
  })
})

it('imports, verifies and reloads through the real operation lock without provisioning', async () => {
  const f = fixture()
  await f.manager.importExisting(f.request)
  const gate = Promise.withResolvers<string>()
  const ssh = vi.fn(async () => gate.promise)
  const registerTarget = vi.fn(async () => 'verified-ssh')
  const service = new SandboxEnvironmentService({
    records: f.store,
    acquire: (target) => f.manager.acquireSandbox(target, { skipInspection: true }),
    inspectSsh: vi.fn(async () => undefined),
    ssh,
    relay: () => ({ id: 'relay', status: 'ok', detail: 'compatible' }),
    registerTarget,
    changed: vi.fn()
  })
  expect((await service.verify(f.request.target)).outcome).toBe('unavailable')
  expect(ssh).not.toHaveBeenCalled()
  f.setInventory([{ ...f.inventory()[0], status: 'running' }])
  const pending = service.verify(f.request.target)
  await vi.waitFor(() => expect(ssh).toHaveBeenCalledOnce())
  await expect(f.manager.importExisting(f.request)).rejects.toThrow('Another sandbox operation')
  await expect(f.manager.provision({})).rejects.toThrow('Another sandbox operation')
  gate.resolve(
    [
      'identity',
      'mount',
      'preparation',
      'certificates',
      'platform',
      'libc',
      ...SANDBOX_BASE_TOOLS,
      'flock'
    ]
      .map(
        (id) =>
          `WILLY_ENV ${id} ok ${Buffer.from(id === 'identity' ? f.request.target.id : 'verified').toString('base64')}`
      )
      .join('\n')
  )
  expect((await pending).outcome).toBe('ready')
  expect(
    f.run.mock.calls.every(([args]) => JSON.stringify(args) === JSON.stringify(['ls', '--json']))
  ).toBe(true)
  expect(f.dependencies.ssh).not.toHaveBeenCalled()
  expect(f.dependencies.connectTarget).not.toHaveBeenCalled()
  const reopened = new SandboxProvisioningManager(
    new SandboxProvisioningStore(f.file),
    f.dependencies
  )
  expect(await reopened.list()).toEqual([
    expect.objectContaining({
      status: 'ready',
      tools: [],
      sshTargetId: 'verified-ssh',
      verification: expect.objectContaining({ outcome: 'ready' })
    })
  ])
  expect(await reopened.importExisting(f.request)).toEqual((await reopened.list())[0])
})

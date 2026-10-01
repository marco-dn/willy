import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { SandboxLifecycleService } from './sandbox-lifecycle-service'
import { SandboxExecutionPolicy } from './sandbox-execution-policy'
import type { Project } from '../../shared/project-types'
const target = { name: 'demo', id: 'sandbox-id' }
function fixture(linked = false) {
  const file = join(mkdtempSync(join(tmpdir(), 'willy-lifecycle-')), 'state.json')
  const records = new SandboxProvisioningStore(file)
  records.save({
    name: 'demo',
    sandboxId: target.id,
    mountPath: '/shared',
    sshTargetId: 'ssh',
    tools: [],
    operationId: 'op',
    status: 'ready',
    stage: 'cleanup',
    updatedAt: 1,
    logs: [],
    versions: []
  })
  const projects: Project[] = [
    {
      id: 'p',
      displayName: 'Project',
      sourceRepoIds: ['repo'],
      badgeColor: 'blue',
      createdAt: 1,
      updatedAt: 1,
      ...(linked
        ? {
            sandboxBinding: {
              sandboxId: target.id,
              sandboxName: 'demo',
              sshTargetId: 'ssh',
              setupId: 'setup',
              repoId: 'repo',
              mountPath: '/shared',
              projectPath: '/shared/repo'
            }
          }
        : {})
    }
  ]
  let state = 'running'
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === 'ls') {
      return JSON.stringify({
        sandboxes:
          state === 'missing'
            ? []
            : [
                {
                  id: target.id,
                  name: 'demo',
                  agent: 'shell',
                  status: state,
                  workspaces: ['/shared']
                }
              ]
      })
    }
    if (args[0] === 'stop') {
      state = 'stopped'
    }
    if (args[0] === 'exec') {
      state = 'running'
    }
    if (args[0] === 'rm') {
      state = 'missing'
    }
    return ''
  })
  const policy = new SandboxExecutionPolicy({ projects: () => projects, available: async () => {} })
  const disconnect = vi.fn(async () => {})
  const connect = vi.fn(async () => {})
  const release = vi.fn()
  const targetIds = vi.fn(() => ['ssh'])
  const service = new SandboxLifecycleService({
    records,
    store: {
      getProjects: () => projects,
      getRepos: () => [
        {
          id: 'repo',
          path: '/shared/repo',
          connectionId: 'ssh',
          displayName: 'Project',
          badgeColor: 'blue',
          addedAt: 1
        }
      ]
    },
    command: async () => run,
    acquire: async () => ({ run, release }),
    policy,
    targetIds,
    disconnect,
    connect,
    changed: () => {}
  })
  return {
    file,
    service,
    records,
    projects,
    run,
    targetIds,
    disconnect,
    connect,
    release,
    policy,
    state: (value: string) => {
      state = value
    }
  }
}
describe('sandbox lifecycle', () => {
  it('persists stop intent before disconnect and stops only the verified sandbox', async () => {
    const f = fixture(true)
    f.disconnect.mockImplementationOnce(async () => {
      expect(f.records.list()[0].lifecycle?.desired).toBe('stopped')
    })
    await f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p'] })
    expect(f.run).toHaveBeenCalledWith(['stop', target.name])
    expect(f.records.list()[0].lifecycle).toEqual({ desired: 'stopped' })
    expect(new SandboxProvisioningStore(f.file).list()[0].lifecycle).toEqual({ desired: 'stopped' })
    expect(f.projects[0].sandboxBinding).toBeTruthy()
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('starts an existing sandbox then connects SSH', async () => {
    const f = fixture(true)
    f.state('stopped')
    await f.service.execute({ target, action: 'start' })
    expect(f.run).toHaveBeenCalledWith(['exec', target.name, '/bin/true'])
    expect(f.connect).toHaveBeenCalledWith('ssh')
  })
  it('requires confirmation of the complete current impact', async () => {
    const f = fixture(true)
    await expect(
      f.service.execute({ target, action: 'stop', confirmedProjectIds: [] })
    ).rejects.toThrow('affected projects changed')
    expect(f.disconnect).not.toHaveBeenCalled()
  })
  it('refuses removing a linked sandbox even with the right name', async () => {
    const f = fixture(true)
    await expect(
      f.service.execute({
        target,
        action: 'remove',
        confirmedProjectIds: ['p'],
        confirmName: 'demo'
      })
    ).rejects.toThrow('Unlink all')
    expect(f.run).not.toHaveBeenCalled()
  })
  it('removes only the sandbox, retaining repository and SSH references', async () => {
    const f = fixture()
    await f.service.execute({
      target,
      action: 'remove',
      confirmedProjectIds: ['p'],
      confirmName: 'demo'
    })
    expect(f.run).toHaveBeenCalledWith(['rm', '--force', target.name])
    expect(f.records.list()[0].lifecycle).toEqual({ desired: 'removed' })
    expect(f.records.list()[0].sshTargetId).toBe('ssh')
    expect(f.projects).toHaveLength(1)
  })
  it('reconciles external removal without issuing another rm', async () => {
    const f = fixture()
    f.state('missing')
    expect((await f.service.snapshot(target)).state).toBe('missing')
    await f.service.execute({
      target,
      action: 'remove',
      confirmedProjectIds: ['p'],
      confirmName: 'demo'
    })
    expect(f.run.mock.calls.every(([args]) => args[0] === 'ls')).toBe(true)
  })
  it('retains stop intent on failure rather than permitting reconnection', async () => {
    const f = fixture()
    f.disconnect.mockRejectedValueOnce(new Error('SSH contact lost'))
    await expect(
      f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p'] })
    ).rejects.toThrow('contact lost')
    expect(f.records.list()[0].lifecycle).toEqual({
      desired: 'stopped',
      pending: 'stop',
      error: 'SSH contact lost'
    })
  })
  it('refuses lifecycle changes while a project operation is running', async () => {
    const f = fixture()
    const release = await f.policy.acquire({ projectId: 'p', hostId: 'local' })
    await expect(
      f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p'] })
    ).rejects.toThrow('still running')
    release()
    expect(f.disconnect).not.toHaveBeenCalled()
  })
  it('never reports missing when the daemon cannot be reached', async () => {
    const f = fixture()
    f.run.mockRejectedValueOnce(new Error('daemon unavailable'))
    await expect(f.service.snapshot(target)).rejects.toThrow('daemon unavailable')
  })
  it('disconnects duplicate aliases without deleting shared SSH targets', async () => {
    const f = fixture()
    f.targetIds.mockReturnValue(['ssh', 'duplicate'])
    await f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p'] })
    expect(f.disconnect.mock.calls).toEqual([['ssh'], ['duplicate']])
    expect(f.records.list()[0].sshTargetId).toBe('ssh')
  })
  it('blocks both linked projects during stop and preserves both associations', async () => {
    const f = fixture(true)
    f.projects.push({ ...f.projects[0], id: 'second', displayName: 'Second' })
    f.disconnect.mockImplementationOnce(async () => {
      for (const project of f.projects) {
        await expect(
          f.policy.acquire({ projectId: project.id, hostId: 'ssh:ssh' })
        ).rejects.toThrow('changing')
      }
    })
    await f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p', 'second'] })
    expect(f.projects.every((project) => project.sandboxBinding?.sandboxId === target.id)).toBe(
      true
    )
  })
  it('refuses a replacement sandbox with the same name before mutation', async () => {
    const f = fixture()
    f.run.mockResolvedValueOnce(
      JSON.stringify({
        sandboxes: [
          {
            id: 'replacement',
            name: 'demo',
            agent: 'shell',
            status: 'running',
            workspaces: ['/shared']
          }
        ]
      })
    )
    await expect(
      f.service.execute({
        target,
        action: 'remove',
        confirmedProjectIds: ['p'],
        confirmName: 'demo'
      })
    ).rejects.toThrow('different sandbox')
    expect(f.disconnect).not.toHaveBeenCalled()
    expect(f.run).toHaveBeenCalledOnce()
  })
  it('preserves the pending operation if sbx returns before the state is confirmed', async () => {
    const f = fixture()
    f.run.mockImplementation(async () =>
      JSON.stringify({
        sandboxes: [
          {
            id: target.id,
            name: 'demo',
            agent: 'shell',
            status: 'running',
            workspaces: ['/shared']
          }
        ]
      })
    )
    await expect(
      f.service.execute({ target, action: 'stop', confirmedProjectIds: ['p'] })
    ).rejects.toThrow('not confirmed')
    expect(f.records.list()[0].lifecycle?.pending).toBe('stop')
    expect(f.records.list()[0].lifecycle?.desired).toBe('stopped')
  })
})

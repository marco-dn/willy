import { describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/project-types'
import { SandboxExecutionPolicy, sandboxContainsPath } from './sandbox-execution-policy'

const binding = {
  sandboxId: 'sbx-id',
  sandboxName: 'test',
  sshTargetId: 'ssh-test',
  setupId: 'remote',
  repoId: 'remote',
  mountPath: '/shared',
  projectPath: '/shared/repo'
}
function fixture(bound = true) {
  const project: Project = {
    id: 'p',
    displayName: 'P',
    badgeColor: 'blue',
    sourceRepoIds: ['local', 'remote'],
    createdAt: 1,
    updatedAt: 1,
    ...(bound ? { sandboxBinding: binding } : {})
  }
  const available = vi.fn(async () => {})
  return {
    project,
    available,
    policy: new SandboxExecutionPolicy({ projects: () => [project], available })
  }
}
const remote = {
  projectId: 'p',
  hostId: 'ssh:ssh-test',
  repoId: 'remote',
  path: '/shared/repo'
} as const

describe('sandbox execution policy', () => {
  it('refuses local, other host, stale repo and paths outside the mount', async () => {
    const { policy } = fixture()
    const run = vi.fn(async () => {})
    for (const target of [
      { ...remote, hostId: 'local' as const },
      { ...remote, hostId: 'ssh:other' as const },
      { ...remote, repoId: 'local' },
      { ...remote, path: '/shared-other/repo' },
      { ...remote, path: '/shared/../etc' }
    ]) {
      await expect(policy.execute(target, run)).rejects.toThrow()
    }
    expect(run).not.toHaveBeenCalled()
  })
  it('does not fall back when the sandbox cannot be verified', async () => {
    const { policy, available } = fixture()
    available.mockRejectedValueOnce(new Error('unverifiable'))
    const run = vi.fn(async () => {})
    await expect(policy.execute(remote, run)).rejects.toThrow('unverifiable')
    expect(run).not.toHaveBeenCalled()
    await expect(policy.transition('p', async () => 'retry')).resolves.toBe('retry')
  })
  it('blocks transitions throughout an operation including the availability probe', async () => {
    const { policy, available } = fixture()
    let release = () => {}
    available.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const running = policy.execute(remote, async () => 'done')
    await expect(policy.transition('p', async () => {})).rejects.toThrow('still running')
    release()
    await expect(running).resolves.toBe('done')
    await expect(policy.transition('p', async () => 'done')).resolves.toBe('done')
  })
  it('blocks new starts and concurrent transitions until the transition finishes', async () => {
    const { policy } = fixture(false)
    let release = () => {}
    const changing = policy.transition(
      'p',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    await expect(policy.execute(remote, async () => {})).rejects.toThrow('changing')
    await expect(policy.transition('p', async () => {})).rejects.toThrow('still running')
    await expect(
      policy.execute({ ...remote, projectId: 'unrelated', hostId: 'local' }, async () => 1)
    ).resolves.toBe(1)
    release()
    await changing
  })
  it('keeps nested operations in one lease and releases failures', async () => {
    const { policy, available } = fixture()
    await expect(
      policy.execute(remote, () =>
        policy.execute(remote, async () => {
          throw new Error('operation failure')
        })
      )
    ).rejects.toThrow('operation failure')
    expect(available).toHaveBeenCalledTimes(1)
    await expect(policy.transition('p', async () => 1)).resolves.toBe(1)
  })
  it('leaves unbound projects unchanged and contains paths with spaces', async () => {
    const { policy, available } = fixture(false)
    await expect(policy.execute({ projectId: 'p', hostId: 'local' }, async () => 42)).resolves.toBe(
      42
    )
    expect(available).not.toHaveBeenCalled()
    expect(sandboxContainsPath('/shared space', '/shared space/my project')).toBe(true)
    expect(sandboxContainsPath('/shared', '/shared2')).toBe(false)
  })
})

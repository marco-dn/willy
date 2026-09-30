import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Project } from '../../shared/project-types'
import {
  configureSandboxExecutionStore,
  withSandboxExecution,
  assertSandboxRelatedPaths
} from './sandbox-execution-boundary'
import { acquireGitAdmission } from '../git/command-runner/git-subprocess-admission'
import { sandboxSshRequestAdmission } from './sandbox-ssh-admission'
vi.mock('./sandbox-command', () => ({
  createSandboxCommand: async () => async () =>
    JSON.stringify({
      sandboxes: [
        { id: 'sandbox', name: 'demo', agent: 'shell', status: 'running', workspaces: ['/shared'] }
      ]
    })
}))
vi.mock('../providers/ssh-filesystem-dispatch', () => ({
  getSshFilesystemProvider: () => ({ realpath: async (path: string) => path })
}))
vi.mock('../ssh/ssh-target-registry', () => {
  const mux = { request: async () => ({ stdout: 'sandbox', exitCode: 0, timedOut: false }) }
  return { getRegisteredSshState: () => ({ status: 'connected' }), getActiveMultiplexer: () => mux }
})
const binding = {
  sandboxId: 'sandbox',
  sandboxName: 'demo',
  sandboxBootId: 'boot-id',
  sshTargetId: 'target',
  setupId: 'remote',
  repoId: 'remote',
  mountPath: '/shared',
  projectPath: '/shared/repo'
}
function fixture(bound = true) {
  const projects: Project[] = [
    {
      id: 'p',
      displayName: 'P',
      badgeColor: 'blue',
      sourceRepoIds: ['local', 'remote'],
      createdAt: 1,
      updatedAt: 1,
      ...(bound ? { sandboxBinding: binding } : {})
    }
  ]
  const repos: Repo[] = [
    { id: 'local', path: '/host/repo', displayName: 'P', badgeColor: 'blue', addedAt: 1 },
    {
      id: 'remote',
      path: '/shared/repo',
      worktreeBasePath: '/shared/worktrees',
      connectionId: 'target',
      displayName: 'P',
      badgeColor: 'blue',
      addedAt: 1
    }
  ]
  const store = {
    getProjects: () => projects,
    getRepos: () => repos,
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined
  }
  return { projects, repos, policy: configureSandboxExecutionStore(store) }
}
afterEach(() => {
  configureSandboxExecutionStore({
    getProjects: () => [],
    getRepos: () => [],
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined
  })
})
describe('sandbox execution boundaries', () => {
  it('rejects local Git at admission before spawning a process', async () => {
    fixture()
    await expect(acquireGitAdmission({ args: ['status'], cwd: '/host/repo' })).rejects.toThrow(
      'only in sandbox'
    )
  })
  it('rejects reopening an old local workspace through either terminal entry point request shape', async () => {
    fixture()
    const spawn = vi.fn(async () => 'spawned')
    await expect(
      withSandboxExecution({ worktreeId: 'local:/host/repo', cwd: '/host/repo' }, spawn)
    ).rejects.toThrow('only in sandbox')
    expect(spawn).not.toHaveBeenCalled()
  })
  it('holds SSH commands until completion and refuses worktree destinations outside the mount', async () => {
    const { policy } = fixture()
    const admit = sandboxSshRequestAdmission('target')
    const release = await admit('git.exec', { cwd: '/shared/repo', args: ['status'] })
    await expect(policy.transition('p', async () => {})).rejects.toThrow('still running')
    release?.()
    await expect(policy.transition('p', async () => {})).resolves.toBeUndefined()
    await expect(
      admit('git.createWorktree', { repoPath: '/shared/repo', worktreePath: '/outside' })
    ).rejects.toThrow('outside')
    expect(() =>
      assertSandboxRelatedPaths({ repoId: 'remote', connectionId: 'target' }, ['/outside'])
    ).toThrow('outside')
  })
  it('does not apply another project association to unrelated work', async () => {
    fixture()
    await expect(withSandboxExecution({ cwd: '/other/repo' }, async () => 'ok')).resolves.toBe('ok')
  })
  it('allows a nested project in the same sandbox without assigning its repo ID to the parent', async () => {
    const { projects, repos } = fixture()
    repos.push({
      id: 'child',
      path: '/shared/repo/child',
      connectionId: 'target',
      displayName: 'Child',
      badgeColor: 'blue',
      addedAt: 1
    })
    projects.push({
      id: 'child-project',
      displayName: 'Child',
      badgeColor: 'blue',
      sourceRepoIds: ['child'],
      createdAt: 1,
      updatedAt: 1,
      sandboxBinding: {
        ...binding,
        repoId: 'child',
        setupId: 'child-setup',
        projectPath: '/shared/repo/child'
      }
    })
    const create = vi.fn(async () => 'created')
    await expect(
      withSandboxExecution(
        {
          repoId: 'child',
          cwd: '/shared/repo/child',
          connectionId: 'target'
        },
        create
      )
    ).resolves.toBe('created')
    expect(create).toHaveBeenCalledOnce()
    await expect(
      withSandboxExecution(
        {
          repoId: 'child',
          cwd: '/shared/repo/child',
          hostId: 'local'
        },
        create
      )
    ).rejects.toThrow('only in sandbox')
  })
  it('prevents starts throughout activation, even before the binding is saved', async () => {
    const { policy } = fixture(false)
    await policy.transition('p', async () => {
      await expect(withSandboxExecution({ cwd: '/host/repo' }, async () => {})).rejects.toThrow(
        'changing'
      )
      await expect(acquireGitAdmission({ args: ['status'], cwd: '/host/repo' })).rejects.toThrow(
        'changing'
      )
    })
  })
})

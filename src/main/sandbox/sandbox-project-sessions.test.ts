import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import type { SshRemotePtyLease } from '../../shared/ssh-types'
import { assertSandboxProjectSessionsClosed } from './sandbox-project-sessions'
const { listProcesses, removed, connectionState } = vi.hoisted(() => ({
  listProcesses: vi.fn(),
  removed: vi.fn(),
  connectionState: vi.fn()
}))
vi.mock('./sandbox-lifecycle-guard', () => ({ isSandboxSshTargetConfirmedRemoved: removed }))
vi.mock('../ssh/ssh-target-registry', () => ({
  listRegisteredSshTargets: () => [{ id: 'sandbox', label: 'Old sandbox', host: 'old.sbx' }],
  getRegisteredSshState: connectionState
}))
vi.mock('../ipc/pty/provider/registry', () => ({ getProvider: () => ({ listProcesses }) }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => null
}))
const project: Project = {
  id: 'p',
  displayName: 'P',
  badgeColor: 'blue',
  sourceRepoIds: ['local', 'remote'],
  createdAt: 1,
  updatedAt: 1
}
const repos: Repo[] = [
  { id: 'local', path: '/host/repo', displayName: 'P', badgeColor: 'blue', addedAt: 1 },
  {
    id: 'remote',
    connectionId: 'sandbox',
    path: '/shared/project',
    displayName: 'P',
    badgeColor: 'blue',
    addedAt: 1
  }
]
function store(leases: SshRemotePtyLease[] = []) {
  return {
    getRepos: () => repos,
    getProjects: () => [project],
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    getSshRemotePtyLeases: () => leases
  }
}
beforeEach(() => {
  listProcesses.mockReset().mockResolvedValue([])
  removed.mockReset().mockResolvedValue(false)
  connectionState.mockReset().mockReturnValue(undefined)
})
describe('sandbox project session preflight', () => {
  it('refuses linking while a local project terminal remains', async () => {
    listProcesses.mockResolvedValueOnce([{ id: 'pty', cwd: '/host/repo', title: '' }])
    await expect(
      assertSandboxProjectSessionsClosed(store(), project, 'ssh:sandbox', 'link')
    ).rejects.toThrow('Close the project terminals')
  })
  it('does not equate unavailable inventory with an empty inventory', async () => {
    listProcesses.mockRejectedValueOnce(new Error('transport lost'))
    await expect(
      assertSandboxProjectSessionsClosed(store(), project, 'ssh:sandbox', 'link')
    ).rejects.toThrow('unverifiable')
  })
  it('does not equate an expired SSH lease with an exited process', async () => {
    const lease: SshRemotePtyLease = {
      targetId: 'sandbox',
      ptyId: 'pty',
      worktreeId: 'remote',
      state: 'expired',
      createdAt: 1,
      updatedAt: 1
    }
    listProcesses.mockRejectedValueOnce(new Error('transport lost'))
    await expect(
      assertSandboxProjectSessionsClosed(store([lease]), project, 'ssh:sandbox', 'unlink')
    ).rejects.toThrow('unverifiable')
    expect(listProcesses).toHaveBeenCalledOnce()
  })
  it('does not block unlinking for another project terminal on the same sandbox', async () => {
    listProcesses.mockResolvedValueOnce([
      { id: 'other', cwd: '/shared/other', title: '', worktreeId: 'other' }
    ])
    await expect(
      assertSandboxProjectSessionsClosed(store(), project, 'ssh:sandbox', 'unlink')
    ).resolves.toBeUndefined()
  })
  it('allows unlink when the SSH host confirms an old lease is absent', async () => {
    await expect(
      assertSandboxProjectSessionsClosed(
        store([
          {
            targetId: 'sandbox',
            ptyId: 'old',
            worktreeId: 'remote',
            state: 'expired',
            createdAt: 1,
            updatedAt: 1
          }
        ]),
        project,
        'ssh:sandbox',
        'unlink'
      )
    ).resolves.toBeUndefined()
    expect(listProcesses).toHaveBeenCalled()
  })
  it('blocks a live leased terminal even without its workspace metadata', async () => {
    listProcesses.mockResolvedValueOnce([{ id: 'ssh:sandbox@@old', cwd: '/tmp', title: '' }])
    await expect(
      assertSandboxProjectSessionsClosed(
        store([
          {
            targetId: 'sandbox',
            ptyId: 'old',
            worktreeId: 'remote',
            state: 'expired',
            createdAt: 1,
            updatedAt: 1
          }
        ]),
        project,
        'ssh:sandbox',
        'unlink'
      )
    ).rejects.toThrow('Close the project SSH terminals')
  })
  it('does not attribute a nested project terminal to its parent project', async () => {
    const child = { ...project, id: 'child', sourceRepoIds: ['child-repo'] }
    const childRepo = { ...repos[1], id: 'child-repo', path: '/shared/project/child' }
    listProcesses.mockResolvedValueOnce([
      {
        id: 'child-pty',
        cwd: '/shared/project/child',
        title: '',
        worktreeId: 'child-repo::/shared/project/child'
      }
    ])
    await expect(
      assertSandboxProjectSessionsClosed(
        {
          ...store(),
          getProjects: () => [project, child],
          getRepos: () => [...repos, childRepo]
        },
        project,
        'ssh:sandbox',
        'unlink'
      )
    ).resolves.toBeUndefined()
  })
})

it('allows linking from the confirmed removed sandbox without querying its old leases', async () => {
  removed.mockResolvedValue(true)
  const lease: SshRemotePtyLease = {
    targetId: 'sandbox',
    ptyId: 'old',
    worktreeId: 'remote',
    state: 'expired',
    createdAt: 1,
    updatedAt: 1
  }
  await expect(
    assertSandboxProjectSessionsClosed(store([lease]), project, 'ssh:new-sandbox', 'link')
  ).resolves.toBeUndefined()
  expect(listProcesses).toHaveBeenCalledOnce()
  expect(lease.state).toBe('expired')
})
it('does not ignore sessions on a currently connected host', async () => {
  connectionState.mockReturnValue({ status: 'connected' })
  removed.mockResolvedValue(true)
  listProcesses.mockRejectedValue(new Error('transport lost'))
  await expect(
    assertSandboxProjectSessionsClosed(store(), project, 'ssh:sandbox', 'unlink')
  ).rejects.toThrow('Old sandbox (old.sbx; sandbox)')
  expect(removed).not.toHaveBeenCalled()
})
it('names the old host when removal cannot be confirmed', async () => {
  removed.mockRejectedValue(new Error('sbx unavailable'))
  await expect(
    assertSandboxProjectSessionsClosed(store(), project, 'ssh:sandbox', 'unlink')
  ).rejects.toThrow('Old sandbox (old.sbx; sandbox)')
})

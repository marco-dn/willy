import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
import type { Store } from '../persistence'
import { projectHostSetupProjectionFromRepos } from '../../shared/project-host-setup-projection'
import { SandboxExecutionPolicy } from './sandbox-execution-policy'
import { SandboxProjectService } from './sandbox-project-service'
import { assertSandboxProjectSessionsClosed } from './sandbox-project-sessions'
import { runSandboxSsh } from './sandbox-command'

vi.mock('./sandbox-project-sessions', () => ({
  assertSandboxProjectSessionsClosed: vi.fn(async () => {})
}))
vi.mock('./sandbox-execution-boundary', () => ({
  verifySandboxExecutionAvailable: vi.fn(async () => {}),
  verifySandboxSshIdentity: vi.fn(async () => {})
}))
vi.mock('./sandbox-command', () => ({
  runSandboxSsh: vi.fn(
    async () =>
      'WILLY_PROJECT_SETUP={"projectPath":"/shared/repo","worktreePath":"/shared/.willy-worktrees/p"}'
  )
}))

function fixture(
  status: ManagedSandbox['status'] = 'ready',
  verification?: ManagedSandbox['verification']
) {
  const repos: Repo[] = [
    {
      id: 'local',
      path: '/host/repo',
      kind: 'folder',
      displayName: 'Project',
      badgeColor: 'blue',
      addedAt: 1
    }
  ]
  let projects: Project[] = [...projectHostSetupProjectionFromRepos(repos).projects]
  const sync = () => {
    projects = projectHostSetupProjectionFromRepos(repos).projects.map((entry) => ({
      ...entry,
      ...(projects.find((old) => old.id === entry.id)?.sandboxBinding
        ? { sandboxBinding: projects.find((old) => old.id === entry.id)?.sandboxBinding }
        : {})
    }))
  }
  const updateRepo: Store['updateRepo'] = (id, updates) => {
    const repo = repos.find((entry) => entry.id === id)
    if (!repo) {
      return null
    }
    Object.assign(repo, updates)
    sync()
    return repo
  }
  const setProjectSandboxBinding: Store['setProjectSandboxBinding'] = (id, binding) => {
    const project = projects.find((entry) => entry.id === id)
    if (!project) {
      throw new Error('missing')
    }
    project.sandboxBinding = binding
  }
  const store = {
    getProjects: () => projects,
    getRepos: () => repos,
    getWorktreeMeta: () => undefined,
    getAllWorktreeMeta: () => ({}),
    getSshRemotePtyLeases: () => [],
    getProjectHostSetups: () => [...projectHostSetupProjectionFromRepos(repos).setups],
    updateRepo,
    setProjectSandboxBinding,
    runDurableMutation: async <T>(mutation: () => { value: T }) => mutation().value
  }
  const release = vi.fn()
  const acquire = vi.fn(async () => ({
    run: vi.fn(async () => '12345678-1234-1234-1234-123456789abc'),
    release
  }))
  const register = vi.fn(async () => {
    const repo: Repo = {
      id: 'remote',
      path: '/shared/repo',
      connectionId: 'ssh',
      kind: 'folder',
      displayName: 'Project',
      badgeColor: 'blue',
      addedAt: 2
    }
    repos.push(repo)
    sync()
    return { repo, alreadyExisted: false }
  })
  const policy = new SandboxExecutionPolicy({
    projects: store.getProjects,
    available: async () => {}
  })
  const service = new SandboxProjectService({
    store,
    policy,
    register,
    acquire,
    changed: vi.fn(),
    list: async () => [
      {
        name: 'test',
        sandboxId: 'id',
        sshTargetId: 'ssh',
        status,
        verification,
        mountPath: '/shared',
        tools: [],
        operationId: 'op',
        stage: 'cleanup',
        updatedAt: 1,
        logs: [],
        versions: []
      }
    ]
  })
  return { service, store, policy, acquire, release, register }
}
const request = {
  target: { name: 'test', id: 'id' },
  projectId: 'repo:local',
  relativePath: 'repo'
}
beforeEach(() => {
  vi.clearAllMocks()
})
describe('sandbox project service', () => {
  it('rejects linking an imported environment even when an SSH target is present', async () => {
    const { service, acquire, register, store } = fixture('imported')
    await expect(service.link(request)).rejects.toThrow('Verify or prepare')
    expect(acquire).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(store.getProjects()[0].sandboxBinding).toBeUndefined()
  })
  it('links a folder project without inventing GitHub identity and preserves the local repo', async () => {
    const { service, store, release } = fixture()
    await service.link(request)
    expect(store.getProjects()).toHaveLength(1)
    expect(store.getProjects()[0]).toMatchObject({
      sourceRepoIds: ['local', 'remote'],
      sandboxBinding: { sandboxId: 'id', repoId: 'remote', setupId: 'remote' }
    })
    expect(store.getRepos()[0].path).toBe('/host/repo')
    expect(store.getRepos().every((repo) => !repo.upstream)).toBe(true)
    expect(store.getRepos()[1].worktreeBasePath).toBe('/shared/.willy-worktrees/p')
    expect(release).toHaveBeenCalledOnce()
  })
  it('does not prepare a folder or bind a project while outside sessions remain', async () => {
    const { service, store, release } = fixture()
    vi.mocked(assertSandboxProjectSessionsClosed).mockRejectedValueOnce(
      new Error('Close terminals')
    )
    await expect(service.link(request)).rejects.toThrow('Close terminals')
    expect(runSandboxSsh).not.toHaveBeenCalled()
    expect(store.getProjects()[0].sandboxBinding).toBeUndefined()
    expect(release).toHaveBeenCalledOnce()
  })
  it('refuses invalid paths before acquiring the sandbox or running SSH', async () => {
    const { service, acquire } = fixture()
    await expect(service.link({ ...request, relativePath: '../escape' })).rejects.toThrow()
    expect(acquire).not.toHaveBeenCalled()
  })
  it('preserves the association if sandbox sessions block unlinking', async () => {
    const { service, store } = fixture()
    await service.link(request)
    vi.mocked(assertSandboxProjectSessionsClosed).mockRejectedValueOnce(
      new Error('Close sandbox terminals')
    )
    await expect(service.unlink(request.projectId)).rejects.toThrow('Close sandbox terminals')
    expect(store.getProjects()[0].sandboxBinding).toBeDefined()
    await service.unlink(request.projectId)
    expect(store.getProjects()[0].sandboxBinding).toBeNull()
    expect(store.getRepos()).toHaveLength(2)
  })
  it('rejects another link instead of replacing an active association', async () => {
    const { service, register } = fixture()
    await service.link(request)
    await expect(service.link(request)).rejects.toThrow('Unlink')
    expect(register).toHaveBeenCalledOnce()
  })
  it('does not activate the association after SSH verification fails', async () => {
    const { service, store, release } = fixture()
    vi.mocked(runSandboxSsh).mockRejectedValueOnce(new Error('Git metadata outside mount'))
    await expect(service.link(request)).rejects.toThrow('outside mount')
    expect(store.getProjects()[0].sandboxBinding).toBeUndefined()
    expect(release).toHaveBeenCalledOnce()
  })
  it('keeps two project associations independent on the same sandbox', async () => {
    const { service, store, register } = fixture()
    await service.link(request)
    store.getRepos().push({
      id: 'second',
      path: '/host/second',
      kind: 'folder',
      displayName: 'Second',
      badgeColor: 'blue',
      addedAt: 1
    })
    store.updateRepo('second', { explicitProjectId: 'repo:second' })
    const second: Repo = {
      id: 'remote-second',
      path: '/shared/second',
      connectionId: 'ssh',
      kind: 'folder',
      displayName: 'Second',
      badgeColor: 'blue',
      addedAt: 2
    }
    register.mockImplementationOnce(async () => {
      store.getRepos().push(second)
      store.updateRepo(second.id, { explicitProjectId: 'repo:second' })
      return { repo: second, alreadyExisted: false }
    })
    vi.mocked(runSandboxSsh).mockResolvedValueOnce(
      'WILLY_PROJECT_SETUP={"projectPath":"/shared/second","worktreePath":"/shared/.willy-worktrees/second"}'
    )
    await service.link({ ...request, projectId: 'repo:second', relativePath: 'second' })
    await service.unlink(request.projectId)
    expect(
      store.getProjects().find((project) => project.id === 'repo:second')?.sandboxBinding?.repoId
    ).toBe('remote-second')
    expect(
      store.getProjects().find((project) => project.id === request.projectId)?.sandboxBinding
    ).toBeNull()
  })
  it('retains the execution constraint when persisting unlink fails', async () => {
    const { service, store } = fixture()
    await service.link(request)
    vi.spyOn(store, 'runDurableMutation').mockImplementationOnce(async (mutate) => {
      mutate()
      throw new Error('write failed')
    })
    await expect(service.unlink(request.projectId)).rejects.toThrow('write failed')
    expect(store.getProjects()[0].sandboxBinding?.sandboxId).toBe('id')
  })
})

it('blocks new links after a failed recheck even for a previously configured record', async () => {
  const { service, acquire, register } = fixture('ready', {
    checkedAt: 2,
    outcome: 'unavailable',
    canPrepare: false,
    checks: []
  })
  await expect(service.link(request)).rejects.toThrow('Verify or prepare')
  expect(acquire).not.toHaveBeenCalled()
  expect(register).not.toHaveBeenCalled()
})

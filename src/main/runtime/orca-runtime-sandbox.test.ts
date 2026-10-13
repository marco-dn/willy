import { beforeEach, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import type { Project } from '../../shared/project-types'
import { projectHostSetupProjectionFromRepos } from '../../shared/project-host-setup-projection'
const mocks = vi.hoisted(() => {
  const store: unknown = undefined
  return { identity: vi.fn(), idle: vi.fn(), store }
})
vi.mock('../sandbox/sandbox-host-identity', () => ({ verifySandboxHostIdentity: mocks.identity }))
vi.mock('../sandbox/sandbox-project-sessions', () => ({
  assertSandboxProjectSessionsClosed: mocks.idle
}))
vi.mock('./orca-runtime-migration-catalog', () => ({
  OrcaRuntimeWithMigrationCatalog: class {
    requireStore() {
      return mocks.store
    }
  }
}))
import { OrcaRuntimeWithSandbox } from './orca-runtime-sandbox'
const request = {
  projectId: 'original-project',
  sandboxId: 'box',
  sandboxName: 'demo',
  sandboxBootId: 'boot',
  sshTargetId: 'ssh',
  mountPath: '/shared',
  projectPath: '/shared/project',
  worktreePath: '/shared/worktrees',
  kind: 'folder' as const,
  displayName: 'Project'
}
function fixture() {
  const repos: Repo[] = []
  let projects: Project[] = []
  const sync = () => {
    projects = projectHostSetupProjectionFromRepos(repos).projects.map((row) => ({
      ...row,
      sandboxBinding: projects.find((p) => p.id === row.id)?.sandboxBinding
    }))
  }
  const store = {
    getRepos: () => repos,
    getProjects: () => projects,
    getWorktreeMeta: () => undefined,
    getAllWorktreeMeta: () => ({}),
    getProjectHostSetups: () => projectHostSetupProjectionFromRepos(repos).setups,
    updateRepo: (id: string, updates: Partial<Repo>) => {
      const repo = repos.find((row) => row.id === id)
      if (!repo) {
        return null
      }
      Object.assign(repo, updates)
      sync()
      return repo
    },
    setProjectSandboxBinding: (id: string, binding: Project['sandboxBinding']) => {
      const project = projects.find((p) => p.id === id)
      if (!project) {
        throw new Error('missing project')
      }
      project.sandboxBinding = binding
    },
    runDurableMutation: async <T>(mutation: () => { value: T }) => mutation().value
  }
  mocks.store = store
  const add = vi.fn(async () => {
    const repo: Repo = {
      id: 'repo',
      path: request.projectPath,
      displayName: request.displayName,
      badgeColor: 'blue',
      addedAt: 1,
      kind: 'folder'
    }
    repos.push(repo)
    sync()
    return repo
  })
  return { runtime: new OrcaRuntimeWithSandbox(), store, add }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.identity.mockResolvedValue(undefined)
  mocks.idle.mockResolvedValue(undefined)
})
it('preserves the original folder project identity and persists host-local execution', async () => {
  const { runtime, store, add } = fixture()
  const result = await runtime.registerSandboxProject(request, add)
  expect(result.repo.explicitProjectId).toBe(request.projectId)
  expect(result.repo.upstream).toBeUndefined()
  expect(store.getProjects()[0].sandboxBinding).toMatchObject({
    executionHostId: 'local',
    sandboxId: 'box',
    repoId: 'repo'
  })
  await runtime.unlinkSandboxProject(request.projectId)
  expect(store.getProjects()[0].sandboxBinding).toBeNull()
})
it('does not create a repository on an unverified host', async () => {
  const { runtime, add } = fixture()
  mocks.identity.mockRejectedValueOnce(new Error('wrong container'))
  await expect(runtime.registerSandboxProject(request, add)).rejects.toThrow('wrong container')
  expect(add).not.toHaveBeenCalled()
})
it('does not reassign another project or unlink while sessions are live', async () => {
  const { runtime, add, store } = fixture()
  await runtime.registerSandboxProject(request, add)
  await expect(
    runtime.registerSandboxProject({ ...request, projectId: 'other' }, add)
  ).rejects.toThrow('another project')
  mocks.idle.mockRejectedValueOnce(new Error('live terminals'))
  await expect(runtime.unlinkSandboxProject(request.projectId)).rejects.toThrow('live terminals')
  expect(store.getProjects()[0].sandboxBinding?.sandboxId).toBe('box')
})

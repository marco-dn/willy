import { beforeEach, expect, it, vi } from 'vitest'
import type { Project } from '../../shared/project-types'
import type { Repo } from '../../shared/repo-types'
const mocks = vi.hoisted(() => ({ register: vi.fn(), verify: vi.fn() }))
vi.mock('./sandbox-runtime-registration', () => ({ registerSandboxRuntimeProject: mocks.register }))
vi.mock('./sandbox-ssh-identity', () => ({ verifySandboxSshIdentity: mocks.verify }))
import { reconcileSandboxProjectBindings } from './sandbox-project-reconnection'
function fixture() {
  const project: Project = {
    id: 'p',
    displayName: 'P',
    badgeColor: 'blue',
    createdAt: 1,
    updatedAt: 1,
    sourceRepoIds: ['old'],
    sandboxBinding: {
      sandboxId: 'box',
      sandboxName: 'demo',
      sandboxBootId: 'boot',
      sshTargetId: 'ssh',
      repoId: 'old',
      setupId: 'old-setup',
      mountPath: '/shared',
      projectPath: '/shared/project'
    }
  }
  const source: Repo = {
    id: 'old',
    path: '/shared/project',
    displayName: 'P',
    badgeColor: 'blue',
    addedAt: 1,
    worktreeBasePath: '/shared/worktrees',
    connectionId: 'ssh'
  }
  const persist = vi.fn((id: string, binding: Project['sandboxBinding']) => {
    expect(id).toBe('p')
    project.sandboxBinding = binding
  })
  const store = {
    getProjects: () => [project],
    getRepos: () => [source],
    getProjectHostSetups: () => [{ id: 'new-setup', repoId: 'new', hostId: 'runtime:env' }],
    setProjectSandboxBinding: persist,
    runDurableMutation: async <T>(mutation: () => { value: T }) => mutation().value
  }
  return { project, store, persist }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.verify.mockResolvedValue(undefined)
  mocks.register.mockResolvedValue({
    repo: { id: 'new', executionHostId: 'runtime:env' },
    environmentId: 'env'
  })
})
it('moves a persisted relay binding to the managed host without changing its project identity or paths', async () => {
  const { store, project, persist } = fixture()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: reconciliation only uses the five store methods implemented by this fixture.
  await reconcileSandboxProjectBindings(store as never, 'ssh')
  expect(project.sandboxBinding).toMatchObject({
    sandboxId: 'box',
    runtimeEnvironmentId: 'env',
    executionHostId: 'runtime:env',
    repoId: 'new',
    setupId: 'new-setup',
    projectPath: '/shared/project'
  })
  expect(mocks.register).toHaveBeenCalledWith(
    store,
    expect.objectContaining({ projectId: 'p', worktreePath: '/shared/worktrees' })
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the same fixture store verifies idempotence after migration.
  await reconcileSandboxProjectBindings(store as never, 'ssh')
  expect(persist).toHaveBeenCalledOnce()
})
it('retains the old restriction when remote identity cannot be verified', async () => {
  const { store, persist } = fixture()
  mocks.verify.mockRejectedValueOnce(new Error('wrong sandbox'))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the fixture provides every store method read before verification fails.
  await expect(reconcileSandboxProjectBindings(store as never, 'ssh')).rejects.toThrow(
    'wrong sandbox'
  )
  expect(persist).not.toHaveBeenCalled()
  expect(mocks.register).not.toHaveBeenCalled()
})

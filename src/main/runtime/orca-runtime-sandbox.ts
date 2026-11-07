import type { Repo } from '../../shared/repo-types'
import { OrcaRuntimeWithAgentTransitions } from './orca-runtime-agent-transitions'
import { OrcaRuntimeWithSidebarTemporal } from './sidebar-inputs/orca-runtime-sidebar-temporal'
import { ORCA_SIDEBAR_INPUTS_IS_MAIN } from '../../shared/sidebar-inputs-switch'
const SandboxRuntimeBase: typeof OrcaRuntimeWithAgentTransitions = ORCA_SIDEBAR_INPUTS_IS_MAIN
  ? OrcaRuntimeWithSidebarTemporal
  : OrcaRuntimeWithAgentTransitions
import type { SandboxRuntimeProjectRequest } from '../../shared/sandbox-runtime-contract'
import { verifySandboxHostIdentity } from '../sandbox/sandbox-host-identity'
import { configureSandboxExecutionStore } from '../sandbox/sandbox-execution-boundary'

export abstract class OrcaRuntimeWithSandbox extends SandboxRuntimeBase {
  async registerSandboxProject(args: SandboxRuntimeProjectRequest, addRepo: () => Promise<Repo>) {
    const policy = configureSandboxExecutionStore(this.requireStore())
    return policy.transition(args.projectId, async () => {
      await this.assertSandboxProjectIdle(args.projectId)
      return this.persistSandboxProject(args, addRepo)
    })
  }

  private async persistSandboxProject(
    args: SandboxRuntimeProjectRequest,
    addRepo: () => Promise<Repo>
  ) {
    await verifySandboxHostIdentity(args, [args.projectPath, args.worktreePath])
    const store = this.requireStore()
    if (!store.setProjectSandboxBinding || !store.runDurableMutation) {
      throw new Error('Sandbox project persistence is unavailable.')
    }
    const existing = store.getRepos().find((repo) => repo.path === args.projectPath)
    const owner =
      existing && store.getProjects?.().find((p) => p.sourceRepoIds.includes(existing.id))
    if (owner && owner.id !== args.projectId) {
      throw new Error('This sandbox folder is already registered to another project.')
    }
    const repo = await addRepo()
    const updated = store.updateRepo(repo, {
      explicitProjectId: args.projectId,
      worktreeBasePath: args.worktreePath
    })
    const setup = store
      .getProjectHostSetups?.()
      .find((row) => row.repoId === repo.id && row.hostId === 'local')
    const project = store.getProjects?.().find((row) => row.id === args.projectId)
    if (!updated || !setup || !project) {
      throw new Error('Sandbox project setup could not be verified.')
    }
    await store.runDurableMutation(() => {
      store.setProjectSandboxBinding!(project, {
        sandboxId: args.sandboxId,
        sandboxName: args.sandboxName,
        sandboxBootId: args.sandboxBootId,
        sshTargetId: args.sshTargetId,
        executionHostId: 'local',
        setupId: setup.id,
        repoId: repo.id,
        mountPath: args.mountPath,
        projectPath: args.projectPath
      })
      return { value: undefined }
    })
    configureSandboxExecutionStore(store)
    return { repo: updated, setup }
  }

  async unlinkSandboxProject(projectId: string) {
    const store = this.requireStore()
    const policy = configureSandboxExecutionStore(store)
    return policy.transition(projectId, async () => {
      await this.assertSandboxProjectIdle(projectId)
      const project = store.getProjects?.().find((row) => row.id === projectId)
      if (!project) {
        throw new Error('Sandbox project no longer exists.')
      }
      if (!store.setProjectSandboxBinding || !store.runDurableMutation) {
        throw new Error('Sandbox project persistence is unavailable.')
      }
      await store.runDurableMutation(() => {
        store.setProjectSandboxBinding!(project, null)
        return { value: undefined }
      })
      return { unlinked: true }
    })
  }

  async assertSandboxProjectIdle(projectId: string) {
    const store = this.requireStore()
    const project = store.getProjects?.().find((row) => row.id === projectId)
    if (!project) {
      return { idle: true }
    }
    const { assertSandboxProjectSessionsClosed } =
      await import('../sandbox/sandbox-project-sessions')
    await assertSandboxProjectSessionsClosed(store, project, 'local', 'unlink')
    return { idle: true }
  }
}

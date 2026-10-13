import { posix } from 'node:path'
import { createHash } from 'node:crypto'
import type { Store } from '../persistence'
import { registerSandboxRuntimeProject } from './sandbox-runtime-registration'
import { verifySandboxSshIdentity } from './sandbox-ssh-identity'
import { getRepoExecutionHostId } from '../../shared/execution-host'

/** Upgrade persisted relay-era associations only after the managed host has connected. */
export async function reconcileSandboxProjectBindings(
  store: Store,
  targetId: string
): Promise<void> {
  for (const project of store.getProjects()) {
    const binding = project.sandboxBinding
    if (!binding || binding.sshTargetId !== targetId || binding.runtimeEnvironmentId) {
      continue
    }
    await verifySandboxSshIdentity(binding)
    const source = store.getRepos().find((repo) => repo.id === binding.repoId)
    if (!source || !binding.sandboxBootId) {
      throw new Error('Sandbox project identity is incomplete. Relink the project.')
    }
    const registered = await registerSandboxRuntimeProject(store, {
      ...binding,
      projectId: project.id,
      sandboxBootId: binding.sandboxBootId,
      worktreePath:
        source.worktreeBasePath ??
        posix.join(
          binding.mountPath,
          '.willy-worktrees',
          createHash('sha256').update(project.id).digest('hex').slice(0, 16)
        ),
      kind: project.kind === 'folder' ? 'folder' : 'git',
      displayName: project.displayName
    })
    const hostId = getRepoExecutionHostId(registered.repo)
    const setup = store
      .getProjectHostSetups()
      .find((row) => row.repoId === registered.repo.id && row.hostId === hostId)
    if (!setup) {
      throw new Error('Sandbox managed project setup is unavailable.')
    }
    await store.runDurableMutation(() => {
      store.setProjectSandboxBinding(project.id, {
        ...binding,
        executionHostId: hostId,
        runtimeEnvironmentId: registered.environmentId,
        repoId: registered.repo.id,
        setupId: setup.id
      })
      return { value: undefined }
    })
  }
}

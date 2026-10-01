import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { z } from 'zod'
import type { Store } from '../persistence'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SandboxAccess } from './sandbox-command'
import type { SandboxExecutionPolicy } from './sandbox-execution-policy'
import { associateRepoWithExistingProject } from '../project-repo-association'
import type { addRemoteRepoFromPath } from '../ipc/repos/remote-repo-registration'
import { assertSandboxProjectSessionsClosed } from './sandbox-project-sessions'
import {
  sandboxProjectLinkSchema,
  sandboxProjectPath,
  sandboxProjectSetupScript,
  parseSandboxProjectSetup
} from './sandbox-project-setup'
import {
  verifySandboxExecutionAvailable,
  verifySandboxSshIdentity
} from './sandbox-execution-boundary'
import { runSandboxSsh } from './sandbox-command'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'

type Dependencies = {
  store: Pick<
    Store,
    | 'getProjects'
    | 'getRepos'
    | 'getAllWorktreeMeta'
    | 'getWorktreeMeta'
    | 'getSshRemotePtyLeases'
    | 'getProjectHostSetups'
    | 'updateRepo'
    | 'setProjectSandboxBinding'
    | 'runDurableMutation'
  >
  register(
    args: Parameters<typeof addRemoteRepoFromPath>[1]
  ): ReturnType<typeof addRemoteRepoFromPath>
  policy: SandboxExecutionPolicy
  list(): Promise<ManagedSandbox[]>
  acquire(target: unknown): Promise<SandboxAccess>
  changed(): void
}

export class SandboxProjectService {
  constructor(private readonly deps: Dependencies) {}

  async link(raw: unknown): Promise<void> {
    const request = sandboxProjectLinkSchema.parse(raw)
    const project = this.deps.store.getProjects().find((entry) => entry.id === request.projectId)
    if (!project) {
      throw new Error('Project not found.')
    }
    if (project.sandboxBinding) {
      throw new Error('Unlink the current sandbox before choosing another one.')
    }
    const managed = (await this.deps.list()).find(
      (entry) => entry.name === request.target.name && entry.sandboxId === request.target.id
    )
    if (
      !managed?.sshTargetId ||
      managed.status !== 'ready' ||
      (managed.verification && managed.verification.outcome !== 'ready')
    ) {
      throw new Error('Verify or prepare the sandbox environment before linking a project.')
    }
    const targetId = managed.sshTargetId
    const hostId = `ssh:${targetId}` as const
    const access = await this.deps.acquire(request.target)
    try {
      await this.deps.policy.transition(project.id, async () => {
        await assertSandboxProjectSessionsClosed(this.deps.store, project, hostId, 'link')
        const projectPath = sandboxProjectPath(managed.mountPath, request.relativePath)
        const worktreePath = posix.join(
          managed.mountPath,
          '.willy-worktrees',
          createHash('sha256').update(project.id).digest('hex').slice(0, 16)
        )
        const preliminary: SandboxProjectBinding = {
          sandboxId: request.target.id,
          sandboxName: managed.name,
          sshTargetId: targetId,
          setupId: '',
          repoId: '',
          mountPath: managed.mountPath,
          projectPath
        }
        await verifySandboxExecutionAvailable(preliminary)
        const bootId = (
          await access.run(['exec', managed.name, 'cat', '/proc/sys/kernel/random/boot_id'])
        ).trim()
        if (!/^[a-f0-9-]{36}$/i.test(bootId)) {
          throw new Error('Could not verify sandbox identity.')
        }
        preliminary.sandboxBootId = bootId
        await verifySandboxSshIdentity(preliminary)
        const kind = project.kind === 'folder' ? 'folder' : 'git'
        if (kind === 'folder' && request.cloneUrl) {
          throw new Error('Folder projects cannot be cloned as Git repositories.')
        }
        const verified = parseSandboxProjectSetup(
          await runSandboxSsh(
            `${managed.name}.sbx`,
            sandboxProjectSetupScript({
              mountPath: managed.mountPath,
              projectPath,
              worktreePath,
              kind,
              bootId,
              cloneUrl: request.cloneUrl,
              gitName: request.gitName,
              gitEmail: request.gitEmail
            })
          )
        )
        const registered = await this.deps.register({
          connectionId: targetId,
          remotePath: verified.projectPath,
          kind,
          displayName: project.displayName,
          setupMethod: request.cloneUrl ? 'cloned' : 'imported-existing-folder'
        })
        if ('error' in registered) {
          throw new Error(registered.error)
        }
        if (registered.alreadyExisted) {
          const owner = this.deps.store
            .getProjectHostSetups()
            .find((entry) => entry.repoId === registered.repo.id && entry.hostId === hostId)
          if (owner && owner.projectId !== project.id) {
            throw new Error(
              'This sandbox folder is already registered to another project. Choose its project or a different folder.'
            )
          }
        }
        const repo = associateRepoWithExistingProject(this.deps.store, registered.repo, project.id)
        if (!repo) {
          throw new Error('Project disappeared while linking its sandbox.')
        }
        this.deps.store.updateRepo(repo.id, { worktreeBasePath: verified.worktreePath }, hostId)
        const setup = this.deps.store
          .getProjectHostSetups()
          .find((entry) => entry.repoId === repo.id && entry.hostId === hostId)
        if (!setup || setup.projectId !== project.id) {
          throw new Error('Sandbox project setup could not be verified.')
        }
        await this.deps.store.runDurableMutation(() => {
          this.deps.store.setProjectSandboxBinding(project.id, {
            ...preliminary,
            projectPath: verified.projectPath,
            setupId: setup.id,
            repoId: repo.id
          })
          return { value: undefined }
        })
      })
    } finally {
      access.release()
      this.deps.changed()
    }
  }

  async unlink(raw: unknown): Promise<void> {
    const projectId = z.string().min(1).max(512).parse(raw)
    await this.deps.policy.transition(projectId, async () => {
      const project = this.deps.store.getProjects().find((entry) => entry.id === projectId)
      if (!project?.sandboxBinding) {
        throw new Error('This project has no sandbox association.')
      }
      await assertSandboxProjectSessionsClosed(
        this.deps.store,
        project,
        `ssh:${project.sandboxBinding.sshTargetId}`,
        'unlink'
      )
      const binding = project.sandboxBinding
      try {
        await this.deps.store.runDurableMutation(() => {
          this.deps.store.setProjectSandboxBinding(projectId, null)
          return {
            value: undefined,
            rollback: () => this.deps.store.setProjectSandboxBinding(projectId, binding)
          }
        })
      } catch (error) {
        this.deps.store.setProjectSandboxBinding(projectId, binding)
        throw error
      }
      this.deps.changed()
    })
  }
}

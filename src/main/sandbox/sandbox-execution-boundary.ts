import { assertSandboxLifecycleAllowsExecution } from './sandbox-lifecycle-guard'
import type { Repo } from '../../shared/repo-types'
import { verifySandboxSshIdentity } from './sandbox-ssh-identity'
export { verifySandboxSshIdentity } from './sandbox-ssh-identity'
import { getRepoExecutionHostId, type ExecutionHostId } from '../../shared/execution-host'
import { getRepoIdFromWorktreeId, splitWorktreeId } from '../../shared/worktree/id'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { RuntimeStore } from '../runtime/runtime-store-contract'
import { getRegisteredSshState } from '../ssh/ssh-target-registry'
import { createSandboxCommand } from './sandbox-command'
import { parseSbxInventory } from './sbx-response'
import {
  SandboxExecutionPolicy,
  sandboxContainsPath,
  type SandboxExecutionTarget
} from './sandbox-execution-policy'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'

type ExecutionRequest = {
  repoId?: string
  worktreeId?: string
  cwd?: string
  connectionId?: string | null
  hostId?: ExecutionHostId
}
type SandboxExecutionStore = Pick<
  RuntimeStore,
  'getProjects' | 'getRepos' | 'getWorktreeMeta' | 'getAllWorktreeMeta'
>
let current: { store: SandboxExecutionStore; policy: SandboxExecutionPolicy } | undefined
let inventory: ReturnType<typeof readInventory> | undefined
async function readInventory() {
  const run = await createSandboxCommand()
  return parseSbxInventory(await run(['ls', '--json'])).sandboxes
}
export async function verifySandboxExecutionAvailable(
  binding: SandboxProjectBinding,
  target?: SandboxExecutionTarget
): Promise<void> {
  assertSandboxLifecycleAllowsExecution(binding.sandboxId)
  inventory ??= readInventory().finally(() => {
    inventory = undefined
  })
  const observed = (await inventory).find(
    (entry) => entry.id === binding.sandboxId && entry.name === binding.sandboxName
  )
  if (
    !observed ||
    observed.status.toLowerCase() !== 'running' ||
    !observed.workspaces.includes(binding.mountPath)
  ) {
    throw new Error(
      `Sandbox ${binding.sandboxName} is unavailable or its shared folder changed. No local fallback is allowed.`
    )
  }
  if (getRegisteredSshState(binding.sshTargetId)?.status !== 'connected') {
    throw new Error(
      `Sandbox ${binding.sandboxName} SSH connection is unavailable. Reconnect it before continuing.`
    )
  }
  if (target) {
    await verifySandboxSshIdentity(binding)
  }
  if (target?.path) {
    const { getSshFilesystemProvider } = await import('../providers/ssh-filesystem-dispatch')
    const provider = getSshFilesystemProvider(binding.sshTargetId)
    if (!provider) {
      throw new Error('Sandbox filesystem is unavailable.')
    }
    const repo = current?.store
      .getRepos()
      .find(
        (entry) =>
          entry.id === binding.repoId &&
          getRepoExecutionHostId(entry) === `ssh:${binding.sshTargetId}`
      )
    for (const path of new Set([
      target.path,
      ...(repo?.worktreeBasePath ? [repo.worktreeBasePath] : [])
    ])) {
      if (!sandboxContainsPath(binding.mountPath, await provider.realpath(path))) {
        throw new Error(
          'Project path or worktree folder resolves outside the sandbox shared folder.'
        )
      }
    }
  }
}

export function configureSandboxExecutionStore(
  store: SandboxExecutionStore
): SandboxExecutionPolicy {
  if (current?.store === store) {
    return current.policy
  }
  const policy = new SandboxExecutionPolicy({
    projects: () => store.getProjects?.() ?? [],
    available: verifySandboxExecutionAvailable
  })
  current = { store, policy }
  return policy
}

function within(root: string, candidate: string): boolean {
  const base = normalizeRuntimePathForComparison(root)
  const path = normalizeRuntimePathForComparison(candidate)
  return path === base || path.startsWith(`${base}/`)
}

export function resolveSandboxExecutionTargets(
  store: Pick<RuntimeStore, 'getRepos' | 'getProjects' | 'getWorktreeMeta' | 'getAllWorktreeMeta'>,
  request: ExecutionRequest
): SandboxExecutionTarget[] {
  const projects = store.getProjects?.() ?? []
  if (!projects.length) {
    return []
  }
  const cwd =
    request.cwd ??
    (request.worktreeId ? splitWorktreeId(request.worktreeId)?.worktreePath : undefined)
  const repoId =
    request.repoId ?? (request.worktreeId ? getRepoIdFromWorktreeId(request.worktreeId) : undefined)
  const hostId: ExecutionHostId =
    request.hostId ?? (request.connectionId ? `ssh:${request.connectionId}` : 'local')
  const knownRepoIds = new Set<string>()
  if (cwd) {
    for (const [id, meta] of Object.entries(store.getAllWorktreeMeta())) {
      const parsed = splitWorktreeId(id)
      if (parsed && (!meta.hostId || meta.hostId === hostId) && within(parsed.worktreePath, cwd)) {
        knownRepoIds.add(parsed.repoId)
      }
    }
  }
  const repos = store
    .getRepos()
    .filter(
      (repo) =>
        repo.id === repoId ||
        (knownRepoIds.has(repo.id) && getRepoExecutionHostId(repo) === hostId) ||
        (cwd &&
          getRepoExecutionHostId(repo) === hostId &&
          (within(repo.path, cwd) || (repo.worktreeBasePath && within(repo.worktreeBasePath, cwd))))
    )
  const meta = request.worktreeId ? store.getWorktreeMeta(request.worktreeId) : undefined
  return projects
    .filter(
      (project) =>
        project.id === meta?.projectId ||
        (repoId !== undefined && project.sandboxBinding?.repoId === repoId) ||
        repos.some((repo) => project.sourceRepoIds.includes(repo.id))
    )
    .map((project) => ({
      projectId: project.id,
      hostId,
      // A nested project can match an ancestor path without sharing its repository identity.
      ...(repoId &&
      (project.sourceRepoIds.includes(repoId) || project.sandboxBinding?.repoId === repoId)
        ? { repoId }
        : {}),
      ...(cwd ? { path: cwd } : {})
    }))
}

export async function withSandboxExecution<T>(
  request: ExecutionRequest,
  operation: () => Promise<T>
): Promise<T> {
  const context = current
  if (!context) {
    return operation()
  }
  const targets = resolveSandboxExecutionTargets(context.store, request)
  const next = (index: number): Promise<T> => {
    const target = targets[index]
    return target ? context.policy.execute(target, () => next(index + 1)) : operation()
  }
  return next(0)
}

export function assertSandboxExecution(request: ExecutionRequest): void {
  if (current) {
    for (const target of resolveSandboxExecutionTargets(current.store, request)) {
      current.policy.assertTarget(target)
    }
  }
}

export async function acquireSandboxExecution(request: ExecutionRequest): Promise<() => void> {
  const releases: (() => void)[] = []
  const release = () => {
    releases
      .splice(0)
      .toReversed()
      .forEach((finish) => finish())
  }
  try {
    if (current) {
      for (const target of resolveSandboxExecutionTargets(current.store, request)) {
        releases.push(await current.policy.acquire(target))
      }
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}

export function acquireSandboxLocalExecution(cwd: string): () => void {
  const releases: (() => void)[] = []
  const release = () => {
    releases
      .splice(0)
      .toReversed()
      .forEach((finish) => finish())
  }
  try {
    if (current) {
      for (const target of resolveSandboxExecutionTargets(current.store, {
        cwd,
        hostId: 'local'
      })) {
        releases.push(current.policy.acquireLocal(target))
      }
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}

export function assertSandboxRelatedPaths(
  request: ExecutionRequest,
  paths: readonly string[]
): void {
  if (!current) {
    return
  }
  for (const target of resolveSandboxExecutionTargets(current.store, request)) {
    for (const path of paths) {
      current.policy.assertTarget({ ...target, path })
    }
  }
}

export function withSandboxRepoExecution<T>(repo: Repo, operation: () => Promise<T>): Promise<T> {
  return withSandboxExecution(
    { repoId: repo.id, cwd: repo.path, hostId: getRepoExecutionHostId(repo) },
    operation
  )
}

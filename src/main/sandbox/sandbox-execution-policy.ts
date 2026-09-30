import { AsyncLocalStorage } from 'node:async_hooks'
import type { ExecutionHostId } from '../../shared/execution-host'
import type { Project } from '../../shared/project-types'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'

export type SandboxExecutionTarget = {
  projectId: string
  hostId: ExecutionHostId
  repoId?: string
  path?: string
}

type PolicyDependencies = {
  projects(): readonly Project[]
  available(binding: SandboxProjectBinding, target: SandboxExecutionTarget): Promise<void>
}

export class SandboxExecutionPolicy {
  private transitions = new Set<string>()
  private active = new Map<string, number>()
  private scope = new AsyncLocalStorage<Map<string, { active: boolean }>>()

  constructor(private readonly deps: PolicyDependencies) {}

  assertTarget(target: SandboxExecutionTarget): void {
    if (this.transitions.has(target.projectId)) {
      throw new Error('The project sandbox association is changing. Retry when it finishes.')
    }
    const binding = this.deps
      .projects()
      .find((project) => project.id === target.projectId)?.sandboxBinding
    if (!binding) {
      return
    }
    if (
      target.hostId !== `ssh:${binding.sshTargetId}` ||
      (target.repoId !== undefined && target.repoId !== binding.repoId)
    ) {
      throw new Error(
        `This project runs only in sandbox ${binding.sandboxName}. Select its sandbox environment.`
      )
    }
    if (target.path !== undefined && !sandboxContainsPath(binding.mountPath, target.path)) {
      throw new Error('This workspace is outside the sandbox shared folder.')
    }
  }

  async execute<T>(target: SandboxExecutionTarget, operation: () => Promise<T>): Promise<T> {
    this.assertTarget(target)
    const inherited = this.scope.getStore()
    if (inherited?.get(target.projectId)?.active) {
      return operation()
    }
    const release = await this.acquire(target)
    const scope = { active: true }
    try {
      return await this.scope.run(
        new Map([...(inherited ?? []), [target.projectId, scope]]),
        operation
      )
    } finally {
      scope.active = false
      release()
    }
  }

  private reserve(target: SandboxExecutionTarget): () => void {
    this.assertTarget(target)
    this.active.set(target.projectId, (this.active.get(target.projectId) ?? 0) + 1)
    let released = false
    const release = () => {
      if (released) {
        return
      }
      released = true
      const remaining = (this.active.get(target.projectId) ?? 1) - 1
      if (remaining) {
        this.active.set(target.projectId, remaining)
      } else {
        this.active.delete(target.projectId)
      }
    }
    return release
  }

  acquireLocal(target: SandboxExecutionTarget): () => void {
    if (target.hostId !== 'local') {
      throw new Error('Remote sandbox admission must verify availability asynchronously.')
    }
    return this.reserve(target)
  }

  async acquire(target: SandboxExecutionTarget): Promise<() => void> {
    const release = this.reserve(target)
    try {
      const binding = this.deps
        .projects()
        .find((project) => project.id === target.projectId)?.sandboxBinding
      if (binding) {
        await this.deps.available(binding, target)
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  async transition<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    if (this.transitions.has(projectId) || this.active.has(projectId)) {
      throw new Error('Project operations are still running. Wait for them to finish and retry.')
    }
    this.transitions.add(projectId)
    try {
      return await operation()
    } finally {
      this.transitions.delete(projectId)
    }
  }
}

export function sandboxContainsPath(mount: string, candidate: string): boolean {
  const root = mount.replace(/\/+$/, '') || '/'
  if (!candidate.startsWith('/') || candidate.split('/').includes('..')) {
    return false
  }
  return candidate === root || candidate.startsWith(root === '/' ? root : `${root}/`)
}

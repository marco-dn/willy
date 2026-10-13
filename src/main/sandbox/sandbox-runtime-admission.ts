import { acquireSandboxExecution } from './sandbox-execution-boundary'

export async function withSandboxRuntimeRequest<T>(
  environmentId: string,
  method: string,
  params: unknown,
  operation: () => Promise<T>
): Promise<T> {
  // Management probes must not recursively acquire the project they are verifying.
  if (method.startsWith('sandbox.') || !params || typeof params !== 'object') {
    return operation()
  }
  const value = (key: string): string | undefined => {
    const field = Reflect.get(params, key)
    return typeof field === 'string' ? field : undefined
  }
  const release = await acquireSandboxExecution({
    hostId: `runtime:${environmentId}`,
    repoId: value('repo') ?? value('repoId') ?? value('repoSelector'),
    worktreeId: value('worktree') ?? value('worktreeId'),
    cwd: value('cwd') ?? value('path') ?? value('repoPath')
  })
  try {
    return await operation()
  } finally {
    release()
  }
}

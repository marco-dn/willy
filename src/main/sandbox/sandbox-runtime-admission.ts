import { acquireSandboxExecution } from './sandbox-execution-boundary'
import { resolveEnvironment } from '../../shared/remote-runtime/host-store/runtime-environment-store'

export function admitSandboxRuntimeCall<
  Args extends [string, string, string, unknown, ...unknown[]],
  Result
>(call: (...args: Args) => Promise<Result>): (...args: Args) => Promise<Result> {
  return (...args) =>
    withSandboxRuntimeRequest(resolveEnvironment(args[0], args[1]).id, args[2], args[3], () =>
      call(...args)
    )
}

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
  const fields = new Map<string, unknown>(Object.entries(params))
  const value = (key: string): string | undefined => {
    const field = fields.get(key)
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

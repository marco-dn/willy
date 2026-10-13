import { acquireSandboxExecution, assertSandboxRelatedPaths } from './sandbox-execution-boundary'

export function sandboxSshRequestAdmission(connectionId: string) {
  return (method: string, params?: Record<string, unknown>): Promise<() => void> | undefined => {
    if (
      !params ||
      !(
        method.startsWith('git.') ||
        method.startsWith('hooks.') ||
        method === 'agent.execNonInteractive'
      )
    ) {
      return undefined
    }
    return admitPaths(connectionId, params)
  }
}

async function admitPaths(
  connectionId: string,
  params: Record<string, unknown>
): Promise<() => void> {
  const releases: (() => void)[] = []
  const release = () => {
    releases
      .splice(0)
      .toReversed()
      .forEach((finish) => finish())
  }
  try {
    const paths = new Set(
      [
        'cwd',
        'repoPath',
        'worktreePath',
        'dirPath',
        'newWorktreePath',
        'targetPath',
        'destination'
      ].flatMap((key) => (typeof params[key] === 'string' ? [params[key]] : []))
    )
    for (const cwd of paths) {
      assertSandboxRelatedPaths({ cwd, connectionId }, [...paths])
      releases.push(await acquireSandboxExecution({ cwd, connectionId }))
    }
    return release
  } catch (error) {
    release()
    throw error
  }
}

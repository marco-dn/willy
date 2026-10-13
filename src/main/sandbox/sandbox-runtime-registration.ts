import { z } from 'zod'
import type { Store } from '../persistence'
import type { SandboxRuntimeProjectRequest } from '../../shared/sandbox-runtime-contract'
import { requestSandboxRuntime, sandboxRuntimeEnvironmentId } from './sandbox-runtime-client'

const registrationSchema = z.object({
  repo: z
    .object({
      id: z.string().min(1),
      path: z.string().min(1),
      displayName: z.string(),
      badgeColor: z.string(),
      addedAt: z.number(),
      kind: z.enum(['git', 'folder']).optional()
    })
    .passthrough(),
  setup: z.object({ id: z.string().min(1) }).passthrough()
})

export async function registerSandboxRuntimeProject(
  store: Store,
  args: SandboxRuntimeProjectRequest
) {
  const environmentId = sandboxRuntimeEnvironmentId(args.sshTargetId)
  const result = registrationSchema.parse(
    await requestSandboxRuntime(environmentId, 'sandbox.registerProject', args)
  )
  const hostId = `runtime:${environmentId}` as const
  const existing = store
    .getRepos()
    .find((repo) => repo.id === result.repo.id && repo.executionHostId === hostId)
  const repo = {
    ...result.repo,
    connectionId: null,
    executionHostId: hostId,
    explicitProjectId: args.projectId
  }
  if (!existing) {
    store.addRepo(repo)
  }
  return { repo: existing ?? repo, alreadyExisted: Boolean(existing), environmentId }
}

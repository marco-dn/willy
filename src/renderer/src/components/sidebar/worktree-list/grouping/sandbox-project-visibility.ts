import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'
import type { ProjectGroupingModel } from './project-grouping'

export function sandboxProjectVisibility(model?: ProjectGroupingModel) {
  const bindings = new Map(
    model?.projects.flatMap((project) => {
      const binding = project.sandboxBinding
      return binding
        ? [...new Set([...project.sourceRepoIds, binding.repoId])].map(
            (repoId) => [repoId, binding] as const
          )
        : []
    })
  )
  return (repo: Repo, hostId: ExecutionHostId = getRepoExecutionHostId(repo)): boolean => {
    const binding = bindings.get(repo.id)
    return (
      !binding ||
      (repo.id === binding.repoId &&
        hostId === (binding.executionHostId ?? `ssh:${binding.sshTargetId}`))
    )
  }
}

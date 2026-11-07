import { getRepoExecutionHostId, type ExecutionHostId } from '../execution-host'
import type { Repo } from '../repo-types'
import type { ProjectSectionModel } from '../project-section-grouping'
import type { SidebarRowPlanInputs } from './sidebar-row-plan'

export function filterSandboxSidebarInputs(inputs: SidebarRowPlanInputs): SidebarRowPlanInputs {
  const isVisible = sandboxProjectVisibility(inputs.projectGrouping)
  const visibleWorktree = (worktree: SidebarRowPlanInputs['worktrees'][number]): boolean => {
    const repo = inputs.repoOfWorktree?.(worktree) ?? inputs.repoMap.get(worktree.repoId)
    return !repo || isVisible(repo, worktree.hostId)
  }
  const repoMap = new Map([...inputs.repoMap].filter(([, repo]) => isVisible(repo)))
  return {
    ...inputs,
    repoMap,
    worktrees: inputs.worktrees.filter(visibleWorktree),
    worktreeMap: new Map(
      [...inputs.worktreeMap].filter(([, worktree]) => visibleWorktree(worktree))
    ),
    pendingCreations: inputs.pendingCreations.filter((creation) => repoMap.has(creation.repoId))
  }
}

export function sandboxProjectVisibility(model?: ProjectSectionModel) {
  const bindings = new Map(
    model?.projects.flatMap((project) => {
      const binding = project.sandboxBinding
      return binding
        ? [...new Set([...(project.sourceRepoIds ?? []), binding.repoId])].map(
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

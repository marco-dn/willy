import { getRepoExecutionHostId } from '../shared/execution-host'
import type { Repo } from '../shared/repo-types'
import type { RuntimeStore } from './runtime/runtime-store-contract'

export function associateRepoWithExistingProject(
  store: Pick<RuntimeStore, 'getProjects' | 'getRepos' | 'updateRepo'>,
  repo: Repo,
  projectId: string
): Repo | null {
  const project = store.getProjects?.().find((entry) => entry.id === projectId)
  if (!project) {
    return null
  }
  const previous = store.getProjects?.().find((entry) => entry.sourceRepoIds.includes(repo.id))
  if (previous?.sandboxBinding && previous.id !== project.id) {
    throw new Error('Unlink the sandbox before moving this repository to another project.')
  }
  // Pin every source before remote enrichment can promote a derived project identity.
  for (const source of store
    .getRepos()
    .filter((entry) => project.sourceRepoIds.includes(entry.id))) {
    if (
      !store.updateRepo(
        source.id,
        { explicitProjectId: project.id },
        getRepoExecutionHostId(source)
      )
    ) {
      throw new Error(`Project source disappeared: ${source.id}`)
    }
  }
  const updated = store.updateRepo(
    repo.id,
    { explicitProjectId: project.id },
    getRepoExecutionHostId(repo)
  )
  if (!updated) {
    throw new Error(`Project setup repo disappeared: ${repo.id}`)
  }
  return updated
}

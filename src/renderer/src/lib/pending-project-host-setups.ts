import type { ExecutionHostId } from '../../../shared/execution-host'
import type { ProjectHostSetup } from '../../../shared/project-types'

export function getPendingSetupByHost(
  projectId: string,
  projectHostSetups: readonly ProjectHostSetup[]
): Map<ExecutionHostId, ProjectHostSetup> {
  const setups = new Map<ExecutionHostId, ProjectHostSetup>()
  for (const setup of projectHostSetups) {
    if (setup.projectId !== projectId || setup.setupState === 'ready') {
      continue
    }
    if (!setups.has(setup.hostId)) {
      setups.set(setup.hostId, setup)
    }
  }
  return setups
}

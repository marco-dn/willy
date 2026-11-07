import { useMemo } from 'react'
import { buildProjectHostSetupOptions } from '@/lib/project-host-setup-options'

export function useProjectHostSetupOptions(
  input: Parameters<typeof buildProjectHostSetupOptions>[0]
) {
  const { projects, projectId, projectHostSetups, eligibleRepos, hosts, selectedSetup } = input
  return useMemo(
    () =>
      buildProjectHostSetupOptions({
        projects,
        projectId,
        projectHostSetups,
        eligibleRepos,
        hosts,
        selectedSetup
      }),
    [projects, projectId, projectHostSetups, eligibleRepos, hosts, selectedSetup]
  )
}

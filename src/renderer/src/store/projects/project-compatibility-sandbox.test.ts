import { describe, expect, it } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import { mergeProjectCompatibilityProject } from './project-compatibility-core'
import { carryProjectStateThroughIdentityChange } from '../../../../shared/project-identity-succession'
const project: Project = {
  id: 'p',
  displayName: 'P',
  badgeColor: 'blue',
  sourceRepoIds: ['local'],
  createdAt: 1,
  updatedAt: 1
}
describe('sandbox project catalog compatibility', () => {
  it('preserves an explicit unlink across projection and renderer merges', () => {
    const bound = {
      ...project,
      sandboxBinding: {
        sandboxId: 'id',
        sandboxName: 'demo',
        sshTargetId: 'ssh',
        repoId: 'remote',
        setupId: 'remote',
        mountPath: '/shared',
        projectPath: '/shared/project'
      }
    }
    const unlinked = carryProjectStateThroughIdentityChange(
      [project],
      [{ ...bound, sandboxBinding: null }]
    ).projects[0]
    expect(unlinked.sandboxBinding).toBeNull()
    expect(mergeProjectCompatibilityProject(bound, unlinked).sandboxBinding).toBeNull()
  })
  it('leaves legacy project records without a binding unchanged', () => {
    expect(mergeProjectCompatibilityProject(project, project)).toEqual(project)
  })
})

import { describe, expect, it } from 'vitest'
import type { Repo } from './repo-types'
import {
  getProjectIdentityKey,
  projectHostSetupProjectionFromRepos
} from './project-host-setup-projection'
import { carryProjectStateThroughIdentityChange } from './project-identity-succession'

const local: Repo = {
  id: 'local',
  path: '/project',
  displayName: 'Project',
  badgeColor: 'blue',
  addedAt: 1
}

describe('explicit project association', () => {
  it.each([
    { kind: 'folder' as const },
    { kind: 'git' as const },
    {
      gitRemoteIdentity: {
        canonicalKey: 'gitlab.com/team/repo',
        remoteName: 'origin',
        remoteUrl: 'https://gitlab.com/team/repo.git'
      }
    },
    { upstream: { owner: 'team', repo: 'repo' } }
  ])('merges selected project independently of remote metadata: %j', (metadata) => {
    const source = { ...local, ...metadata }
    const projectId = getProjectIdentityKey(source)
    const remote = {
      ...source,
      id: 'remote',
      connectionId: 'sandbox',
      explicitProjectId: projectId
    }
    const result = projectHostSetupProjectionFromRepos([source, remote])
    expect(result.projects).toHaveLength(1)
    expect(result.projects[0].sourceRepoIds).toEqual(['local', 'remote'])
    expect(result.setups.map((setup) => setup.projectId)).toEqual([projectId, projectId])
    expect(result.setups.map((setup) => setup.hostId)).toEqual(['local', 'ssh:sandbox'])
  })
  it('preserves a sandbox binding across projection refreshes', () => {
    const projected = projectHostSetupProjectionFromRepos([local]).projects[0]
    const sandboxBinding = {
      sandboxId: 'id',
      sandboxName: 'test',
      sshTargetId: 'ssh',
      setupId: 'remote',
      repoId: 'remote',
      mountPath: '/shared',
      projectPath: '/shared/repo'
    }
    const previous = { ...projected, sandboxBinding, updatedAt: 10 }
    expect(
      carryProjectStateThroughIdentityChange([projected], [previous]).projects[0]
    ).toMatchObject({ sandboxBinding, updatedAt: 10 })
  })
})

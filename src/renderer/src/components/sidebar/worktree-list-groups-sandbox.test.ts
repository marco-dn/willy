import { expect, it } from 'vitest'
import { buildRows } from './worktree-list/grouping/build-rows.test-fixture'
import {
  repo,
  remoteRepo,
  worktree,
  remoteWorktree,
  project,
  projectHostSetups
} from './worktree-list/grouping/worktree-list-groups-test-fixtures'
import type { Project } from '../../../../shared/project-types'

const linked: Project = {
  ...project,
  sandboxBinding: {
    sandboxId: 'sandbox',
    sandboxName: 'demo',
    sshTargetId: 'gpu-vm',
    setupId: remoteRepo.id,
    repoId: remoteRepo.id,
    mountPath: '/home/alice',
    projectPath: remoteRepo.path
  }
}
function rows(project: Project) {
  return buildRows(
    'repo',
    [worktree, remoteWorktree],
    new Map([
      [repo.id, repo],
      [remoteRepo.id, remoteRepo]
    ]),
    null,
    new Set(),
    undefined,
    undefined,
    undefined,
    {},
    undefined,
    false,
    undefined,
    [],
    new Set([repo.id]),
    new Map(),
    new Map(),
    [],
    { projects: [project], projectHostSetups }
  )
}
it('shows only the sandbox workspace after linking and restores the local workspace after unlinking', () => {
  expect(
    rows(linked)
      .filter((row) => row.type === 'item')
      .map((row) => row.worktree.id)
  ).toEqual([remoteWorktree.id])
  expect(
    rows({ ...linked, sandboxBinding: null })
      .filter((row) => row.type === 'item')
      .map((row) => row.worktree.id)
  ).toEqual([worktree.id, remoteWorktree.id])
})

import { acquireSandboxGitAdmission } from './sandbox-git-admission'
import {
  GitAdmissionScheduler,
  type GitAdmissionGrant,
  type GitAdmissionRequest
} from '../../../shared/git-admission-scheduler'
import { resolveGitAdmissionTier } from './git-operation-executor'
export * from '../../../shared/git-admission-scheduler'

let scheduler = new GitAdmissionScheduler()

export function acquireGitAdmission(request: GitAdmissionRequest): Promise<GitAdmissionGrant> {
  return acquireSandboxGitAdmission(request, () =>
    process.env.ORCA_GIT_ADMISSION_DISABLED === '1'
      ? Promise.resolve({ queueWaitMs: 0, release: () => {} })
      : scheduler.acquire({ ...request, tier: resolveGitAdmissionTier(request.tier) })
  )
}

export function _resetGitAdmissionForTests(replacement = new GitAdmissionScheduler()): void {
  scheduler = replacement
}

export function _gitAdmissionSnapshotForTests(): ReturnType<GitAdmissionScheduler['snapshot']> {
  return scheduler.snapshot()
}

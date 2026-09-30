import { acquireSandboxExecution } from '../../sandbox/sandbox-execution-boundary'
import type { GitAdmissionRequest, GitAdmissionGrant } from './git-admission-state'
export async function acquireSandboxGitAdmission(
  request: GitAdmissionRequest,
  acquire: () => Promise<GitAdmissionGrant>
): Promise<GitAdmissionGrant> {
  const releaseSandbox = await acquireSandboxExecution({ cwd: request.cwd })
  try {
    const grant =
      process.env.ORCA_GIT_ADMISSION_DISABLED === '1'
        ? { queueWaitMs: 0, release: () => {} }
        : await acquire()
    return {
      ...grant,
      release: () => {
        grant.release()
        releaseSandbox()
      }
    }
  } catch (error) {
    releaseSandbox()
    throw error
  }
}

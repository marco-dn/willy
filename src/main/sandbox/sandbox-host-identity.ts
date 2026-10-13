import { readFile, realpath } from 'node:fs/promises'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'
import { sandboxContainsPath } from './sandbox-execution-policy'

export async function verifySandboxHostIdentity(
  binding: Pick<SandboxProjectBinding, 'sandboxId' | 'sandboxBootId' | 'mountPath'>,
  paths: string[] = []
): Promise<void> {
  const bootId = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
  if (
    process.env.SANDBOX_ID
      ? process.env.SANDBOX_ID !== binding.sandboxId
      : !binding.sandboxBootId || bootId !== binding.sandboxBootId
  ) {
    throw new Error('The execution host is not the selected sandbox.')
  }
  for (const path of [binding.mountPath, ...paths]) {
    if (!sandboxContainsPath(binding.mountPath, await realpath(path))) {
      throw new Error('Project path resolves outside the sandbox shared folder.')
    }
  }
}

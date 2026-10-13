import { getSshConnectionManager } from '../ssh/ssh-target-registry'
import { execCommand } from '../ssh/ssh-relay-exec-command'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'

export async function verifySandboxSshIdentity(binding: SandboxProjectBinding): Promise<void> {
  const manager = getSshConnectionManager()
  const connection = manager?.getConnection(binding.sshTargetId)
  if (!connection) {
    throw new Error('Sandbox SSH connection is unavailable. Reconnect it before continuing.')
  }
  const output = await execCommand(
    connection,
    'printf "%s\\n" "${SANDBOX_ID-}"; cat /proc/sys/kernel/random/boot_id',
    { timeoutMs: 10_000 }
  )
  if (manager?.getConnection(binding.sshTargetId) !== connection) {
    throw new Error('Sandbox SSH connection changed during verification. Retry after reconnecting.')
  }
  const [sandboxId, bootId] = output.trimEnd().split('\n')
  if (sandboxId) {
    if (sandboxId !== binding.sandboxId) {
      throw new Error(
        'The connected SSH host belongs to a different sandbox. Check the SSH target configuration.'
      )
    }
  } else if (!binding.sandboxBootId || bootId !== binding.sandboxBootId) {
    throw new Error(
      'The guest boot identity could not be verified. Unlink and link the project again.'
    )
  }
}

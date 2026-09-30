import { getActiveMultiplexer } from '../ssh/ssh-target-registry'
import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { SandboxProjectBinding } from '../../shared/sandbox-project-types'

const identities = new WeakMap<SshChannelMultiplexer, Promise<string | null>>()

function readSandboxId(mux: SshChannelMultiplexer): Promise<string | null> {
  let pending = identities.get(mux)
  if (!pending) {
    // No project cwd: this fixed environment probe must not recursively request project admission.
    pending = mux
      .request(
        'agent.execNonInteractive',
        {
          binary: '/usr/bin/printenv',
          args: ['SANDBOX_ID'],
          stdin: null,
          timeoutMs: 5000,
          operation: 'sandbox-identity'
        },
        { timeoutMs: 10_000 }
      )
      .then((response) => {
        if (
          !response ||
          typeof response !== 'object' ||
          !('exitCode' in response) ||
          !('stdout' in response) ||
          typeof response.stdout !== 'string' ||
          ('timedOut' in response && response.timedOut)
        ) {
          throw new Error('Could not verify the sandbox identity on the connected SSH host.')
        }
        if (response.exitCode === 1 && !response.stdout.trim()) {
          return null
        }
        if (response.exitCode !== 0 || !response.stdout.trim()) {
          throw new Error('Could not verify the sandbox identity on the connected SSH host.')
        }
        return response.stdout.trim()
      })
      .catch((error: unknown) => {
        identities.delete(mux)
        throw error
      })
    identities.set(mux, pending)
  }
  return pending
}

export async function verifySandboxSshIdentity(binding: SandboxProjectBinding): Promise<void> {
  const mux = getActiveMultiplexer(binding.sshTargetId)
  if (!mux) {
    throw new Error('Sandbox SSH connection is unavailable. Reconnect it before continuing.')
  }
  const sandboxId = await readSandboxId(mux)
  if (getActiveMultiplexer(binding.sshTargetId) !== mux) {
    throw new Error('Sandbox SSH connection changed during verification. Retry after reconnecting.')
  }
  if (sandboxId !== null) {
    if (sandboxId !== binding.sandboxId) {
      throw new Error(
        'The connected SSH host belongs to a different sandbox. Check the SSH target configuration.'
      )
    }
    return
  }
  // Older guests without SANDBOX_ID retain the strict boot identity check.
  const response = await mux.request(
    'fs.readFile',
    {
      filePath: '/proc/sys/kernel/random/boot_id'
    },
    { timeoutMs: 15_000 }
  )
  if (
    !binding.sandboxBootId ||
    !response ||
    typeof response !== 'object' ||
    !('content' in response) ||
    typeof response.content !== 'string' ||
    response.content.trim() !== binding.sandboxBootId ||
    getActiveMultiplexer(binding.sshTargetId) !== mux
  ) {
    throw new Error(
      'This guest does not expose a stable sandbox identity and its boot identity could not be verified. Unlink and link the project again.'
    )
  }
}

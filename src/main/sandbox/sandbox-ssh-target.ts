import { runProcess } from '../../shared/child-process/run-process'
import { findSystemSsh } from '../ssh/system-ssh-binary'
import { parseSshGOutput, sshGArgsForHost } from '../ssh/ssh-g-config-resolution'
import {
  getSshTargetRegistryStore,
  connectRegisteredSshTarget,
  getRegisteredSshState
} from '../ssh/ssh-target-registry'
import { addRegisteredSshTarget } from '../ipc/ssh-target-crud-handlers'

export async function registerSandboxSshTarget(
  alias: string,
  previousId?: string
): Promise<string> {
  const store = getSshTargetRegistryStore()
  if (!store) {
    throw new Error('SSH target registry is unavailable.')
  }
  const previous = previousId ? store.getTarget(previousId) : undefined
  if (previous && (previous.configHost ?? previous.host) !== alias) {
    throw new Error(
      'The saved SSH target now points at a different alias. Restore it before resuming.'
    )
  }
  const existing =
    previous ?? store.listTargets().find((target) => (target.configHost ?? target.host) === alias)
  const program = findSystemSsh()
  if (!program) {
    throw new Error('OpenSSH is unavailable.')
  }
  const result = await runProcess({
    program,
    args: sshGArgsForHost(alias),
    timeoutMs: 15_000,
    maxOutputBytes: 128 * 1024
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error('Could not resolve the sandbox SSH configuration.')
  }
  const config = parseSshGOutput(result.stdout)
  if (existing) {
    if (
      (existing.host !== config.hostname && existing.host !== alias) ||
      existing.port !== config.port ||
      existing.username !== config.user ||
      (existing.proxyCommand && existing.proxyCommand !== config.proxyCommand)
    ) {
      throw new Error(
        'The existing SSH target differs from the sandbox SSH configuration. Review it in SSH settings before resuming.'
      )
    }
    return existing.id
  }
  if (!config.proxyCommand || !config.user) {
    throw new Error('Sandbox SSH ProxyCommand or user is missing. Check sbx setup ssh.')
  }
  return addRegisteredSshTarget({
    label: alias,
    configHost: alias,
    host: config.hostname,
    port: config.port,
    username: config.user,
    identityFile: config.identityFile[0],
    identityAgent: config.identityAgent,
    identitiesOnly: config.identitiesOnly,
    proxyCommand: config.proxyCommand,
    jumpHost: config.proxyJump,
    source: 'ssh-config',
    systemSshConnectionReuse: false
  }).target.id
}
export async function connectSandboxSshTarget(id: string): Promise<void> {
  if (getRegisteredSshState(id)?.status === 'connected') {
    return
  }
  const state = await connectRegisteredSshTarget(id)
  if (state.status !== 'connected') {
    throw new Error('Sandbox SSH connection is not ready. Check SSH settings, then Resume.')
  }
}

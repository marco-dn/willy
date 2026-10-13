import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime-client'
import { getPreferredPairedRuntimeConnection } from '../../shared/runtime-environments'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import { getAppEnvironment } from '../../shared/app-environment'
import { listEnvironments, resolveEnvironment } from '../../shared/runtime-environment-store'
import { getRegisteredSshState } from '../ssh/ssh-target-registry'

export function sandboxRuntimeEnvironmentId(targetId: string): string {
  const state = getRegisteredSshState(targetId)
  if (state?.status !== 'connected' || state.managedServer?.kind !== 'managed') {
    throw new Error('Connect the sandbox managed server before continuing.')
  }
  return state.managedServer.environmentId
}

export async function requestSandboxRuntime(
  environmentId: string,
  method: string,
  params: unknown
): Promise<unknown> {
  const userData = getAppEnvironment().getPath('userData')
  const environment = resolveEnvironment(userData, environmentId)
  if (!environment.runtimeId) {
    throw new Error('The sandbox server identity has not been verified. Reconnect it.')
  }
  const { ensureOrcadManagedTunnel } = await import('../ssh/orcad-managed-tunnel')
  await ensureOrcadManagedTunnel(userData, environmentId)
  const current = resolveEnvironment(userData, environmentId)
  if (current.runtimeId !== environment.runtimeId) {
    throw new Error('The sandbox server identity changed before the request.')
  }
  const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
    getPreferredPairedRuntimeConnection(current),
    method,
    params,
    30_000,
    (status) => {
      if (!status.ok || status._meta?.runtimeId !== environment.runtimeId) {
        throw new Error('The sandbox server identity could not be verified.')
      }
    },
    undefined,
    ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
  )
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  if (response._meta?.runtimeId !== environment.runtimeId) {
    throw new Error('The sandbox server identity changed during the request.')
  }
  return response.result
}

export function sandboxRuntimeHostIds(targetIds: string[]): string[] {
  const ids = new Set(targetIds)
  return listEnvironments(getAppEnvironment().getPath('userData'))
    .filter(
      (environment) =>
        environment.orcadDeployment && ids.has(environment.orcadDeployment.sshTargetId)
    )
    .map((environment) => `runtime:${environment.id}`)
}

import { listRegisteredSshTargets } from '../ssh/ssh-target-registry'
import { SandboxLifecycleService } from '../sandbox/sandbox-lifecycle-service'
import { configureSandboxLifecycleGuard } from '../sandbox/sandbox-lifecycle-guard'
import { disconnectRegisteredSshTarget } from './ssh-session-teardown'
import { connectSandboxSshTarget } from '../sandbox/sandbox-ssh-target'
import { addRemoteRepoFromPath } from './repos/remote-repo-registration'
import type { Store } from '../persistence'
import type { BrowserWindow } from 'electron'
import { SandboxProjectService } from '../sandbox/sandbox-project-service'
import { configureSandboxExecutionStore } from '../sandbox/sandbox-execution-boundary'
import { notifyReposChanged } from './repos/repos-changed-notification'
import { registerSandboxCredentialHandlers } from './sandbox-credentials'
import { SandboxPolicyService } from '../sandbox/sandbox-policy-service'
import { join } from 'node:path'
import { SandboxProvisioningStore } from '../sandbox/sandbox-provisioning-store'
import {
  SandboxProvisioningManager,
  defaultSandboxCommands
} from '../sandbox/sandbox-provisioning-manager'
import { app, ipcMain } from 'electron'
import { inspectLocalSandboxes } from '../sandbox/sbx-inspection'
import type { SandboxInspection } from '../../shared/sandbox-types'

let inspectionInFlight: Promise<SandboxInspection> | null = null

let records: SandboxProvisioningStore | undefined
function provisioningRecords(): SandboxProvisioningStore {
  records ??= new SandboxProvisioningStore(join(app.getPath('userData'), 'willy-sandboxes.json'))
  return records
}

let manager: SandboxProvisioningManager | undefined
function provisioningManager(): SandboxProvisioningManager {
  manager ??= new SandboxProvisioningManager(provisioningRecords(), {
    ...defaultSandboxCommands,
    registerTarget: async (alias, previousId) =>
      (await import('../sandbox/sandbox-ssh-target')).registerSandboxSshTarget(alias, previousId),
    connectTarget: async (id) =>
      (await import('../sandbox/sandbox-ssh-target')).connectSandboxSshTarget(id)
  })
  return manager
}

export async function recoverSandboxProvisioning(): Promise<void> {
  await provisioningManager().list()
}

export function registerSandboxHandlers(store?: Store, mainWindow?: BrowserWindow): void {
  const acquire = (target: unknown) => provisioningManager().acquireSandbox(target)
  if (store && mainWindow) {
    configureSandboxLifecycleGuard(() => provisioningRecords().list())
    const lifecycle = new SandboxLifecycleService({
      records: provisioningRecords(),
      store,
      command: defaultSandboxCommands.command,
      acquire: (target) => provisioningManager().acquireSandbox(target, { skipInspection: true }),
      policy: configureSandboxExecutionStore(store),
      targetIds: (record) => [
        ...new Set([
          ...(record.sshTargetId ? [record.sshTargetId] : []),
          ...listRegisteredSshTargets()
            .filter((target) => (target.configHost ?? target.host) === `${record.name}.sbx`)
            .map((target) => target.id)
        ])
      ],
      disconnect: disconnectRegisteredSshTarget,
      connect: connectSandboxSshTarget,
      changed: () => notifyReposChanged(mainWindow)
    })
    ipcMain.removeHandler('sandboxes:lifecycleSnapshot')
    ipcMain.removeHandler('sandboxes:lifecycle')
    ipcMain.handle('sandboxes:lifecycleSnapshot', (_event, target: unknown) =>
      lifecycle.snapshot(target)
    )
    ipcMain.handle('sandboxes:lifecycle', (_event, request: unknown) => lifecycle.execute(request))
    const projects = new SandboxProjectService({
      store,
      policy: configureSandboxExecutionStore(store),
      acquire,
      register: (args) => addRemoteRepoFromPath(store, args),
      list: () => provisioningManager().list(),
      changed: () => notifyReposChanged(mainWindow)
    })
    for (const channel of ['sandboxes:linkProject', 'sandboxes:unlinkProject']) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.handle('sandboxes:linkProject', (_event, request: unknown) => projects.link(request))
    ipcMain.handle('sandboxes:unlinkProject', (_event, projectId: unknown) =>
      projects.unlink(projectId)
    )
  }
  const policy = new SandboxPolicyService(acquire)
  ipcMain.removeHandler('sandboxes:policy')
  ipcMain.handle('sandboxes:policy', (_event, request: unknown) => policy.execute(request))
  registerSandboxCredentialHandlers(acquire)
  ipcMain.removeHandler('sandboxes:listManaged')
  ipcMain.removeHandler('sandboxes:provision')
  ipcMain.handle('sandboxes:listManaged', () => provisioningManager().list())
  ipcMain.handle('sandboxes:provision', (_event, request: unknown) =>
    provisioningManager().provision(request)
  )
  ipcMain.removeHandler('sandboxes:inspect')
  ipcMain.handle('sandboxes:inspect', () => {
    // Share probes across windows without retaining stale observations.
    inspectionInFlight ??= inspectLocalSandboxes().finally(() => {
      inspectionInFlight = null
    })
    return inspectionInFlight
  })
}

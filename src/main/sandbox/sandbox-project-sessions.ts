import { isSandboxSshTargetConfirmedRemoved } from './sandbox-lifecycle-guard'
import { listRegisteredSshTargets, getRegisteredSshState } from '../ssh/ssh-target-registry'
import type { Project } from '../../shared/project-types'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../shared/execution-host'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { Store } from '../persistence'
import { getProvider } from '../ipc/pty/provider/registry'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import { verifyUnstoppedPtys } from '../runtime/unstopped-pty-verification'
import { toAppSshPtyId } from '../../shared/ssh-pty-id'
import { resolveSandboxExecutionTargets } from './sandbox-execution-boundary'

export async function assertSandboxProjectSessionsClosed(
  store: Pick<
    Store,
    'getRepos' | 'getProjects' | 'getWorktreeMeta' | 'getAllWorktreeMeta' | 'getSshRemotePtyLeases'
  >,
  project: Project,
  sandboxHost: `ssh:${string}`,
  mode: 'link' | 'unlink'
): Promise<void> {
  const relevant = store.getRepos().filter((repo) => project.sourceRepoIds.includes(repo.id))
  const hosts = new Set(
    relevant
      .map(getRepoExecutionHostId)
      .filter((host) => (mode === 'link' ? host !== sandboxHost : host === sandboxHost))
  )
  if (mode === 'unlink') {
    hosts.add(sandboxHost)
  }
  const sshTargets = listRegisteredSshTargets()
  const hostDescription = (targetId: string) => {
    const target = sshTargets.find((entry) => entry.id === targetId)
    return target ? `${target.label} (${target.configHost ?? target.host}; ${targetId})` : targetId
  }
  const unverifiable = (targetId: string) =>
    `Project SSH sessions on ${hostDescription(targetId)} are unverifiable. Reconnect this host in Settings → SSH, close the project's sessions, then retry.`
  for (const hostId of hosts) {
    const host = parseExecutionHostId(hostId)
    if (host?.kind !== 'ssh' || getRegisteredSshState(host.targetId)?.status === 'connected') {
      continue
    }
    const target = sshTargets.find((entry) => entry.id === host.targetId)
    try {
      if (target && (await isSandboxSshTargetConfirmedRemoved(target))) {
        hosts.delete(hostId)
      }
    } catch {
      throw new Error(
        `Project SSH sessions on ${hostDescription(host.targetId)} are unverifiable. Sandbox removal could not be checked. Restore the local sbx service and retry.`
      )
    }
  }
  const unresolvedLeases = store
    .getSshRemotePtyLeases()
    .filter(
      (lease) =>
        hosts.has(`ssh:${lease.targetId}`) &&
        lease.state !== 'terminated' &&
        lease.worktreeId &&
        project.sourceRepoIds.includes(getRepoIdFromWorktreeId(lease.worktreeId))
    )
  for (const targetId of new Set(unresolvedLeases.map((lease) => lease.targetId))) {
    const ids = unresolvedLeases
      .filter((lease) => lease.targetId === targetId)
      .map((lease) => toAppSshPtyId(targetId, lease.ptyId))
    let verdict
    try {
      verdict = await verifyUnstoppedPtys(ids, getProvider(targetId), 15_000)
    } catch {
      throw new Error(unverifiable(targetId))
    }
    if (verdict.status !== 'exited') {
      throw new Error(
        verdict.status === 'live'
          ? `Close the project SSH terminals on ${hostDescription(targetId)} before ${mode === 'link' ? 'linking' : 'unlinking'}: ${verdict.ptyIds.join(', ')}`
          : unverifiable(targetId)
      )
    }
  }
  const structured = getStructuredAgentSessionHost()?.listSessionTabs() ?? []
  if (
    structured.some((session) =>
      relevant.some(
        (repo) =>
          repo.id === getRepoIdFromWorktreeId(session.workspaceId) &&
          hosts.has(getRepoExecutionHostId(repo))
      )
    )
  ) {
    throw new Error('Close the project agent sessions before changing its sandbox association.')
  }
  for (const hostId of hosts) {
    const host = parseExecutionHostId(hostId)
    if (!host || host.kind === 'runtime') {
      throw new Error(
        'Sessions on a paired runtime cannot be verified here. Remove that project environment before linking a local sandbox.'
      )
    }
    let processes
    try {
      processes = await getProvider(host.kind === 'ssh' ? host.targetId : null).listProcesses({
        deadlineMs: Date.now() + 15_000
      })
    } catch {
      throw new Error(
        `Project sessions on ${host.kind === 'ssh' ? hostDescription(host.targetId) : hostId} are unverifiable. Reconnect the host and close its sessions before continuing.`
      )
    }
    if (
      processes.some((process) => {
        const repoId = process.worktreeId ? getRepoIdFromWorktreeId(process.worktreeId) : undefined
        // Workspace ownership takes precedence over an ancestor project's directory.
        if (repoId && store.getProjects().some((entry) => entry.sourceRepoIds.includes(repoId))) {
          return project.sourceRepoIds.includes(repoId)
        }
        return resolveSandboxExecutionTargets(store, {
          hostId,
          worktreeId: process.worktreeId,
          cwd: process.cwd
        }).some((target) => target.projectId === project.id)
      })
    ) {
      throw new Error(
        `Close the project terminals on ${hostId} before changing its sandbox association.`
      )
    }
  }
}

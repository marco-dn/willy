import { runProcess } from '../../shared/child-process/run-process'
import type { SandboxInspection, SandboxInspectionError } from '../../shared/sandbox-types'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { parseSbxInventory, parseSbxVersion } from './sbx-response'

type SbxInspectionDependencies = {
  resolveCommand: typeof resolveCommandOnLocalPath
  run: typeof runProcess
}

export async function inspectLocalSandboxes(
  dependencies: SbxInspectionDependencies = {
    resolveCommand: resolveCommandOnLocalPath,
    run: runProcess
  }
): Promise<SandboxInspection> {
  const diagnostics: Pick<
    SandboxInspection,
    'cliPath' | 'clientVersion' | 'serverVersion' | 'serverState'
  > = { cliPath: null, clientVersion: null, serverVersion: null, serverState: null }
  const failure = (reason: SandboxInspectionError, detail: string): SandboxInspection => ({
    ...diagnostics,
    status: 'error',
    reason,
    detail
  })

  try {
    diagnostics.cliPath = await dependencies.resolveCommand('sbx', {
      searchCurrentDirectory: false
    })
    if (!diagnostics.cliPath) {
      return failure('cli-missing', '')
    }
    const cliPath = diagnostics.cliPath
    const run = (args: string[]) =>
      dependencies.run({
        program: cliPath,
        args,
        timeoutMs: 15_000,
        maxOutputBytes: 1024 * 1024
      })
    const version = await run(['version', '--json'])
    if (version.timedOut) {
      return failure('timeout', 'sbx version --json')
    }
    if (version.outputTruncated) {
      return failure('invalid-response', 'sbx version --json: output exceeded 1 MiB')
    }
    if (version.code !== 0) {
      return failure('command-failed', version.stderr.trim().slice(0, 2000))
    }
    try {
      const parsed = parseSbxVersion(version.stdout)
      diagnostics.clientVersion = parsed.client.version
      diagnostics.serverVersion = parsed.server.version ?? null
      diagnostics.serverState = parsed.server.state
    } catch {
      return failure('invalid-response', 'sbx version --json')
    }
    if (diagnostics.serverState !== 'running') {
      return failure('service-unavailable', diagnostics.serverState ?? '')
    }
    const inventory = await run(['ls', '--json'])
    if (inventory.timedOut) {
      return failure('timeout', 'sbx ls --json')
    }
    if (inventory.outputTruncated) {
      return failure('invalid-response', 'sbx ls --json: output exceeded 1 MiB')
    }
    if (inventory.code !== 0) {
      return failure('command-failed', inventory.stderr.trim().slice(0, 2000))
    }
    try {
      return {
        ...diagnostics,
        status: 'ready',
        sandboxes: parseSbxInventory(inventory.stdout).sandboxes
      }
    } catch {
      return failure('invalid-response', 'sbx ls --json')
    }
  } catch (error) {
    return failure('command-failed', error instanceof Error ? error.message.slice(0, 2000) : '')
  }
}

import { runProcess } from '../../shared/child-process/run-process'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { findSystemSsh } from '../ssh/system-ssh-binary'
import { sshGArgsForHost } from '../ssh/ssh-g-config-resolution'

export type SandboxCommand = (
  args: string[],
  options?: { expectedExitCodes: number[] }
) => Promise<string>
export type SandboxAccess = { run: SandboxCommand; release: () => void }
export type SandboxProvisioningDependencies = {
  command: () => Promise<SandboxCommand>
  ssh: typeof runSandboxSsh
  registerTarget: (alias: string, previousId?: string) => Promise<string>
  connectTarget: (id: string) => Promise<void>
}
export async function createSandboxCommand(): Promise<SandboxCommand> {
  const program = await resolveCommandOnLocalPath('sbx', { searchCurrentDirectory: false })
  if (!program) {
    throw new Error('Install sbx and start its local daemon before provisioning.')
  }
  return async (args, options) => {
    const result = await runProcess({
      program,
      args,
      timeoutMs: ['create', 'exec', 'stop', 'rm'].includes(args[0]) ? 120_000 : 15_000,
      maxOutputBytes: 1024 * 1024
    })
    if (
      result.timedOut ||
      !(options?.expectedExitCodes ?? [0]).includes(result.code ?? -1) ||
      result.outputTruncated
    ) {
      throw new Error(
        `sbx ${args[0]} failed${result.timedOut ? ' (timeout)' : ''}: ${result.stderr.slice(-1500)}`
      )
    }
    return result.stdout
  }
}
export async function runSandboxSsh(
  alias: string,
  script: string,
  options?: { verification: boolean }
): Promise<string> {
  const program = findSystemSsh()
  if (!program) {
    throw new Error('Install an OpenSSH client before provisioning.')
  }
  const configArgs = sshGArgsForHost(alias)
  const prefix = configArgs[0] === '-F' ? configArgs.slice(0, 2) : []
  const result = await runProcess({
    program,
    args: [
      ...prefix,
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=3',
      '-o',
      'ControlMaster=no',
      '-o',
      'ControlPath=none',
      '--',
      alias,
      'bash -s'
    ],
    input: script,
    timeoutMs: options?.verification ? 90_000 : 30 * 60_000,
    maxOutputBytes: 128 * 1024
  })
  if (result.timedOut || result.code !== 0 || (options?.verification && result.outputTruncated)) {
    throw new Error(
      `SSH ${options?.verification ? 'verification failed' : 'provisioning incomplete'}${result.timedOut ? ' (timeout; remote work may still be running)' : ''}: ${result.stderr.slice(-1500)}`
    )
  }
  if (options?.verification) {
    return result.stdout
  }
  return `${result.outputTruncated ? '[Output truncated]\n' : ''}${result.stdout.slice(-16_000)}`
}

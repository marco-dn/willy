import { homedir } from 'node:os'
import { resolveCommandOnLocalPath } from '../ipc/command-path-resolver'
import { spawnNativeDaemonPty } from '../daemon/pty-subprocess/native-pty-spawn'

export async function spawnSandboxCredentialPty(name: string, cols: number, rows: number) {
  const program = await resolveCommandOnLocalPath('sbx', { searchCurrentDirectory: false })
  if (!program) {
    throw new Error('sbx is unavailable.')
  }
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value
    }
  }
  return spawnNativeDaemonPty({
    shellPath: program,
    shellArgs: ['--debug=false', 'secret', 'set', 'github', '--sandbox', name],
    spawnCwd: homedir(),
    env,
    cols,
    rows,
    windowsFallbackAttempts: []
  })
}

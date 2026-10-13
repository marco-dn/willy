import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => '/tools/sbx'),
  spawn: vi.fn(async () => ({}))
}))
vi.mock('../ipc/command-path-resolver', () => ({ resolveCommandOnLocalPath: mocks.resolve }))
vi.mock('../daemon/pty-subprocess/native-pty-spawn', () => ({ spawnNativeDaemonPty: mocks.spawn }))
import { spawnSandboxCredentialPty } from './sandbox-credential-pty'
describe('credential PTY launch', () => {
  it('launches sbx directly with a scoped prompt and debug disabled, without a shell or token argument', async () => {
    await spawnSandboxCredentialPty('demo', 80, 20)
    expect(mocks.resolve).toHaveBeenCalledWith('sbx', { searchCurrentDirectory: false })
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        shellPath: '/tools/sbx',
        shellArgs: ['--debug=false', 'secret', 'set', 'github', '--sandbox', 'demo'],
        cols: 80,
        rows: 20,
        windowsFallbackAttempts: []
      })
    )
  })
})

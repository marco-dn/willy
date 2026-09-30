import { describe, expect, it, vi } from 'vitest'
import { SandboxCredentialSessions } from './sandbox-credential-session'
import type { SandboxAccess } from './sandbox-command'

const sessionId = '11111111-1111-4111-8111-111111111111'
const request = { sessionId, target: { name: 'demo', id: 'sandbox-id' }, cols: 80, rows: 20 }
function fixture() {
  let data: ((chunk: string) => void) | undefined
  let exit: ((event: { exitCode: number; signal?: number }) => void) | undefined
  let disposeOwner: (() => void) | undefined
  const process = {
    onData: vi.fn((listener: (chunk: string) => void) => {
      data = listener
      return { dispose: vi.fn() }
    }),
    onExit: vi.fn((listener: (event: { exitCode: number; signal?: number }) => void) => {
      exit = listener
      return { dispose: vi.fn() }
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(() => exit?.({ exitCode: 130 }))
  }
  const release = vi.fn()
  const acquire = vi.fn<() => Promise<SandboxAccess>>(async () => ({
    run: vi.fn(async () => ''),
    release
  }))
  const spawn = vi.fn(async () => ({ process, reportsChildExitStatus: true }))
  const owner = {
    id: 1,
    send: vi.fn(),
    onDispose: (listener: () => void) => {
      disposeOwner = listener
      return vi.fn()
    }
  }
  return {
    sessions: new SandboxCredentialSessions({ acquire, spawn }),
    process,
    release,
    acquire,
    spawn,
    owner,
    data: (chunk: string) => data?.(chunk),
    exit: (code: number) => exit?.({ exitCode: code }),
    dispose: () => disposeOwner?.()
  }
}
describe('private sandbox credential PTY', () => {
  it('passes input only to the owning PTY, without echoing or adding it to launch arguments', async () => {
    const f = fixture()
    await f.sessions.start(f.owner, request)
    f.sessions.write(1, { sessionId, data: 'secret-test-value' })
    expect(f.process.write).toHaveBeenCalledWith('secret-test-value')
    expect(f.owner.send).not.toHaveBeenCalled()
    expect(f.spawn).toHaveBeenCalledWith('demo', 80, 20)
    expect(JSON.stringify(f.spawn.mock.calls)).not.toContain('secret-test-value')
    f.data('GitHub token:')
    expect(f.owner.send).toHaveBeenCalledWith({ sessionId, type: 'data', data: 'GitHub token:' })
    f.exit(0)
    expect(f.owner.send).toHaveBeenLastCalledWith({ sessionId, type: 'exit', result: 'completed' })
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('rejects input and resize from another renderer and ignores its close request', async () => {
    const f = fixture()
    await f.sessions.start(f.owner, request)
    expect(() => f.sessions.write(2, { sessionId, data: 'untrusted' })).toThrow('unavailable')
    expect(() => f.sessions.resize(2, { sessionId, cols: 80, rows: 20 })).toThrow('unavailable')
    f.sessions.close(2, sessionId)
    expect(f.process.kill).not.toHaveBeenCalled()
    f.sessions.close(1, sessionId)
    expect(f.owner.send).toHaveBeenLastCalledWith({ sessionId, type: 'exit', result: 'cancelled' })
  })
  it('closes when its renderer disappears and never declares cancellation successful', async () => {
    const f = fixture()
    await f.sessions.start(f.owner, request)
    f.dispose()
    expect(f.process.kill).toHaveBeenCalledOnce()
    expect(f.owner.send).toHaveBeenLastCalledWith({ sessionId, type: 'exit', result: 'cancelled' })
  })
  it('cancels safely while prerequisite checks are still pending', async () => {
    const f = fixture()
    let resolve: ((access: SandboxAccess) => void) | undefined
    f.acquire.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const opening = f.sessions.start(f.owner, request)
    f.sessions.close(1, sessionId)
    resolve?.({ run: vi.fn(async () => ''), release: f.release })
    await opening
    expect(f.spawn).not.toHaveBeenCalled()
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('reports failed startup with a generic error and releases its lease', async () => {
    const f = fixture()
    f.spawn.mockRejectedValue(new Error('private diagnostic'))
    await expect(f.sessions.start(f.owner, request)).rejects.toThrow(
      'Could not open the private sbx prompt'
    )
    expect(JSON.stringify(f.owner.send.mock.calls)).not.toContain('private diagnostic')
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('does not treat a wrapper exit code as credential success', async () => {
    const f = fixture()
    f.spawn.mockResolvedValue({ process: f.process, reportsChildExitStatus: false })
    await f.sessions.start(f.owner, request)
    f.exit(0)
    expect(f.owner.send).toHaveBeenLastCalledWith({ sessionId, type: 'exit', result: 'failed' })
  })
})

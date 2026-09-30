import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySandboxSshIdentity } from './sandbox-ssh-identity'
const { active } = vi.hoisted(() => ({ active: vi.fn() }))
vi.mock('../ssh/ssh-target-registry', () => ({ getActiveMultiplexer: active }))
const binding = {
  sandboxId: 'sandbox-id',
  sandboxName: 'demo',
  sandboxBootId: 'old-boot',
  sshTargetId: 'target',
  setupId: 'setup',
  repoId: 'repo',
  mountPath: '/shared',
  projectPath: '/shared/repo'
}
function relay(stdout = 'sandbox-id\n') {
  const mux = { request: vi.fn().mockResolvedValue({ stdout, exitCode: 0, timedOut: false }) }
  active.mockReturnValue(mux)
  return mux
}
beforeEach(() => active.mockReset())
describe('sandbox SSH identity', () => {
  it('accepts the same sandbox after a guest reboot without relinking', async () => {
    const mux = relay()
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
    expect(mux.request).toHaveBeenCalledWith(
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
  })
  it('shares the read on one channel but verifies again after reconnect', async () => {
    const first = relay()
    await Promise.all([verifySandboxSshIdentity(binding), verifySandboxSshIdentity(binding)])
    expect(first.request).toHaveBeenCalledOnce()
    const second = relay('different-sandbox')
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('different sandbox')
    expect(second.request).toHaveBeenCalledOnce()
  })
  it('never trusts a response from a replaced channel', async () => {
    const first = relay()
    first.request.mockImplementationOnce(async () => {
      relay()
      return { stdout: 'sandbox-id', exitCode: 0 }
    })
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('connection changed')
  })
  it('allows retry after a transport failure', async () => {
    const mux = relay()
    mux.request.mockRejectedValueOnce(new Error('transport lost'))
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('transport lost')
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
    expect(mux.request).toHaveBeenCalledTimes(2)
  })
  it('keeps legacy guests restricted to the verified boot', async () => {
    const mux = relay()
    mux.request
      .mockResolvedValueOnce({ stdout: '', exitCode: 1, timedOut: false })
      .mockResolvedValueOnce({ content: 'old-boot\n' })
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
    mux.request.mockResolvedValueOnce({ content: 'new-boot' })
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('boot identity')
  })
  it('rejects incomplete or timed-out identity reads', async () => {
    const mux = relay()
    mux.request.mockResolvedValueOnce({ stdout: 'sandbox-id', exitCode: 0, timedOut: true })
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('Could not verify')
  })
})

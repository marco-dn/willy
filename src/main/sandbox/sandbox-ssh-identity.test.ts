import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifySandboxSshIdentity } from './sandbox-ssh-identity'
const { active, exec } = vi.hoisted(() => ({ active: vi.fn(), exec: vi.fn() }))
vi.mock('../ssh/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ getConnection: active })
}))
vi.mock('../ssh/ssh-relay-exec-command', () => ({ execCommand: exec }))
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
beforeEach(() => {
  active.mockReset()
  exec.mockReset()
  active.mockReturnValue({})
  exec.mockResolvedValue('sandbox-id\nnew-boot\n')
})
describe('sandbox SSH identity over the managed server transport', () => {
  it('accepts the stable sandbox identity after reboot', async () => {
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
  })
  it('rejects a replaced SSH transport', async () => {
    exec.mockImplementationOnce(async () => {
      active.mockReturnValue({})
      return 'sandbox-id\nnew-boot\n'
    })
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('connection changed')
  })
  it('rejects a different sandbox', async () => {
    exec.mockResolvedValue('different-sandbox\nold-boot\n')
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('different sandbox')
  })
  it('checks the boot identity of guests without SANDBOX_ID on every request', async () => {
    exec.mockResolvedValueOnce('\nold-boot\n').mockResolvedValueOnce('\nnew-boot\n')
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('boot identity')
  })
  it('does not cache transport failures or incomplete reads', async () => {
    exec.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('')
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('timeout')
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('boot identity')
    await expect(verifySandboxSshIdentity(binding)).resolves.toBeUndefined()
  })
  it('rejects disconnected hosts', async () => {
    active.mockReturnValue(undefined)
    await expect(verifySandboxSshIdentity(binding)).rejects.toThrow('unavailable')
    expect(exec).not.toHaveBeenCalled()
  })
})

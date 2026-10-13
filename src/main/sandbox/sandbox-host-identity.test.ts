import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ read: vi.fn(), realpath: vi.fn() }))
vi.mock('node:fs/promises', () => ({ readFile: mocks.read, realpath: mocks.realpath }))
import { verifySandboxHostIdentity } from './sandbox-host-identity'
const binding = { sandboxId: 'box', sandboxBootId: 'old-boot', mountPath: '/shared' }
beforeEach(() => {
  mocks.read.mockResolvedValue('new-boot\n')
  mocks.realpath.mockImplementation(async (path: string) => path)
  vi.stubEnv('SANDBOX_ID', 'box')
})
afterEach(() => vi.unstubAllEnvs())
it('accepts reboot with stable identity and checks real paths', async () => {
  await expect(verifySandboxHostIdentity(binding, ['/shared/project'])).resolves.toBeUndefined()
  expect(mocks.realpath).toHaveBeenCalledWith('/shared/project')
})
it('rejects symlink escape and a different container', async () => {
  mocks.realpath.mockResolvedValueOnce('/shared').mockResolvedValueOnce('/outside')
  await expect(verifySandboxHostIdentity(binding, ['/shared/link'])).rejects.toThrow('outside')
  vi.stubEnv('SANDBOX_ID', 'other')
  await expect(verifySandboxHostIdentity(binding)).rejects.toThrow('not the selected sandbox')
})
it('requires the original boot when stable identity is unavailable', async () => {
  vi.stubEnv('SANDBOX_ID', '')
  await expect(verifySandboxHostIdentity(binding)).rejects.toThrow('not the selected sandbox')
  mocks.read.mockResolvedValue('old-boot\n')
  await expect(verifySandboxHostIdentity(binding)).resolves.toBeUndefined()
})

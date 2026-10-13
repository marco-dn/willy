import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }))
vi.mock('./sandbox-execution-boundary', () => ({ acquireSandboxExecution: mocks.acquire }))
import { withSandboxRuntimeRequest } from './sandbox-runtime-admission'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.acquire.mockResolvedValue(mocks.release)
})
it('holds the project claim for a managed runtime operation and releases on failure', async () => {
  const operation = vi.fn(async () => {
    throw new Error('remote failure')
  })
  await expect(
    withSandboxRuntimeRequest(
      'env',
      'worktree.create',
      { repo: 'repo', cwd: '/shared/project' },
      operation
    )
  ).rejects.toThrow('remote failure')
  expect(mocks.acquire).toHaveBeenCalledWith({
    hostId: 'runtime:env',
    repoId: 'repo',
    cwd: '/shared/project',
    worktreeId: undefined
  })
  expect(mocks.release).toHaveBeenCalledOnce()
})
it('does not dispatch when the project restriction rejects the selected host', async () => {
  mocks.acquire.mockRejectedValueOnce(new Error('wrong host'))
  const operation = vi.fn()
  await expect(
    withSandboxRuntimeRequest(
      'wrong',
      'terminal.create',
      { worktree: 'repo:/shared/project' },
      operation
    )
  ).rejects.toThrow('wrong host')
  expect(operation).not.toHaveBeenCalled()
})
it('does not recursively acquire during identity and session probes', async () => {
  const operation = vi.fn(async () => ({ verified: true }))
  await expect(
    withSandboxRuntimeRequest('env', 'sandbox.verifyPath', { path: '/shared/project' }, operation)
  ).resolves.toEqual({ verified: true })
  expect(mocks.acquire).not.toHaveBeenCalled()
})

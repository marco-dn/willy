import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), state: vi.fn(), environment: vi.fn() }))
vi.mock('../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => '/profile' })
}))
vi.mock('../../shared/runtime-environment-store', () => ({ resolveEnvironment: mocks.environment }))
vi.mock('../ssh/ssh-target-registry', () => ({ getRegisteredSshState: mocks.state }))
vi.mock('../../shared/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: mocks.call
}))
vi.mock('../../shared/runtime-environments', () => ({
  getPreferredPairedRuntimeConnection: () => ({ endpoint: 'ws://sandbox' })
}))
vi.mock('../ssh/orcad-managed-tunnel', () => ({ ensureOrcadManagedTunnel: async () => {} }))
import { requestSandboxRuntime, sandboxRuntimeEnvironmentId } from './sandbox-runtime-client'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.environment.mockReturnValue({ runtimeId: 'server' })
  mocks.state.mockReturnValue({
    status: 'connected',
    managedServer: { kind: 'managed', environmentId: 'env' }
  })
  mocks.call.mockResolvedValue({
    ok: true,
    result: { verified: true },
    _meta: { runtimeId: 'server' }
  })
})
it('pins requests to the managed server identity', async () => {
  expect(sandboxRuntimeEnvironmentId('ssh')).toBe('env')
  await expect(requestSandboxRuntime('env', 'sandbox.verifyPath', {})).resolves.toEqual({
    verified: true
  })
  expect(mocks.call).toHaveBeenCalledWith(
    { endpoint: 'ws://sandbox' },
    'sandbox.verifyPath',
    {},
    30_000,
    expect.any(Function),
    undefined,
    expect.any(Array)
  )
})
it('refuses legacy or disconnected hosts without a local fallback', () => {
  mocks.state.mockReturnValue({ status: 'connected' })
  expect(() => sandboxRuntimeEnvironmentId('ssh')).toThrow('managed server')
  expect(mocks.call).not.toHaveBeenCalled()
})
it('rejects a replaced server and unavailable methods on older peers', async () => {
  mocks.call.mockResolvedValueOnce({ ok: true, result: {}, _meta: { runtimeId: 'replacement' } })
  await expect(requestSandboxRuntime('env', 'sandbox.verifyPath', {})).rejects.toThrow(
    'identity changed'
  )
  mocks.call.mockResolvedValueOnce({ ok: false, error: { message: 'method not found' } })
  await expect(requestSandboxRuntime('env', 'sandbox.verifyPath', {})).rejects.toThrow(
    'method not found'
  )
})

import { expect, it, vi } from 'vitest'
import { teardownSshTargetTransport } from './ssh/ssh-session-teardown'

const mocks = vi.hoisted(() => ({
  target: vi.fn(),
  close: vi.fn(),
  disconnect: vi.fn(),
  forwards: vi.fn(),
  bridge: vi.fn()
}))
vi.mock('../ssh/targets/ssh-target-registry', () => ({
  getSshTargetRegistryStore: () => ({ getTarget: mocks.target })
}))
vi.mock('../managed-server/lifecycle/orcad-managed-tunnel', () => ({
  closeOrcadManagedTunnel: mocks.close,
  closeOrcadManagedTunnelsForTarget: vi.fn()
}))
vi.mock('./ssh/ssh-ipc-context', () => ({
  connectionManager: { disconnect: mocks.disconnect },
  portForwardManager: { removeAllForwards: mocks.forwards },
  persistedStore: undefined
}))
vi.mock('../ssh/legacy-relay/legacy-relay-bridge-registry', () => ({
  stopLegacyRelayBridge: mocks.bridge
}))
vi.mock('../ssh/ssh-host-server-status', () => ({ clearSshHostServerStatus: vi.fn() }))
vi.mock('../ssh/connection/ssh-connection-attribution', () => ({
  isSshConnectionSolelyOwnedBy: vi.fn()
}))
vi.mock('./ssh/ssh-connect-attempt-registry', () => ({
  connectInFlight: new Map(),
  invalidateConnectAttempt: vi.fn(),
  isCurrentConnectAttempt: vi.fn()
}))
vi.mock('./ssh/ssh-target-lifecycle-queue', () => ({ runTargetLifecycle: vi.fn() }))

it('waits for the managed tunnel to close before disconnecting a stopped sandbox host', async () => {
  let finish = () => {}
  mocks.target.mockReturnValue({ orcadFence: { environmentId: 'sandbox-runtime' } })
  mocks.close.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const pending = teardownSshTargetTransport('sandbox-target')
  expect(mocks.close).toHaveBeenCalledWith('sandbox-runtime')
  expect(mocks.disconnect).not.toHaveBeenCalled()
  finish()
  await pending
  expect(mocks.disconnect).toHaveBeenCalledWith('sandbox-target')
  expect(mocks.forwards).toHaveBeenCalledWith('sandbox-target')
})

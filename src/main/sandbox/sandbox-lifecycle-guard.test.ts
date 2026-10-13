import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  assertSandboxSshConnectionAllowed,
  isSandboxSshTargetConfirmedRemoved,
  configureSandboxLifecycleGuard
} from './sandbox-lifecycle-guard'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SshTarget } from '../../shared/ssh-types'
const { run } = vi.hoisted(() => ({ run: vi.fn() }))
vi.mock('./sandbox-command', () => ({ createSandboxCommand: async () => run }))
const record: ManagedSandbox = {
  name: 'demo',
  sandboxId: 'id',
  mountPath: '/shared',
  sshTargetId: 'target',
  tools: [],
  operationId: 'op',
  status: 'ready',
  stage: 'cleanup',
  updatedAt: 1,
  logs: [],
  versions: []
}
const target = { id: 'target', host: 'demo.sbx', configHost: 'demo.sbx' }
afterEach(() => {
  configureSandboxLifecycleGuard(() => [])
  run.mockReset()
})
// Only identity fields are read by the guard; use the public target type at the production boundary.
function check(input: Pick<SshTarget, 'id' | 'host' | 'configHost'> = target) {
  return assertSandboxSshConnectionAllowed(input)
}
describe('sandbox SSH connection guard', () => {
  it('blocks stopped intent after restoring persisted records without querying sbx', async () => {
    configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired: 'stopped' } }])
    await expect(check()).rejects.toThrow('stopped or removed')
    expect(run).not.toHaveBeenCalled()
  })
  it('blocks duplicate SSH aliases even with another target ID', async () => {
    configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired: 'removed' } }])
    await expect(check({ ...target, id: 'duplicate' })).rejects.toThrow('stopped or removed')
  })
  it('refuses an externally stopped sandbox without starting it', async () => {
    configureSandboxLifecycleGuard(() => [record])
    run.mockResolvedValue(
      JSON.stringify({
        sandboxes: [
          { id: 'id', name: 'demo', agent: 'shell', status: 'stopped', workspaces: ['/shared'] }
        ]
      })
    )
    await expect(check()).rejects.toThrow('will not start it automatically')
    expect(run).toHaveBeenCalledWith(['ls', '--json'])
  })
  it('allows unrelated SSH targets without calling sbx', async () => {
    configureSandboxLifecycleGuard(() => [record])
    await expect(
      check({ id: 'other', host: 'server', configHost: undefined })
    ).resolves.toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })
})

it('confirms completed removal only against a current readable inventory', async () => {
  configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired: 'removed' } }])
  run.mockResolvedValue(JSON.stringify({ sandboxes: [] }))
  await expect(isSandboxSshTargetConfirmedRemoved(target)).resolves.toBe(true)
  expect(run).toHaveBeenCalledWith(['ls', '--json'])
  run.mockRejectedValue(new Error('daemon unavailable'))
  await expect(isSandboxSshTargetConfirmedRemoved(target)).rejects.toThrow('daemon unavailable')
})
it.each(['stop', 'remove'] as const)(
  'does not treat pending %s as completed removal',
  async (pending) => {
    configureSandboxLifecycleGuard(() => [
      { ...record, lifecycle: { desired: 'removed', pending } }
    ])
    await expect(isSandboxSshTargetConfirmedRemoved(target)).resolves.toBe(false)
    expect(run).not.toHaveBeenCalled()
  }
)
it.each(['id', 'replacement'])('does not ignore a present or replaced sandbox: %s', async (id) => {
  configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired: 'removed' } }])
  run.mockResolvedValue(
    JSON.stringify({
      sandboxes: [{ id, name: 'demo', agent: 'shell', status: 'running', workspaces: ['/shared'] }]
    })
  )
  await expect(isSandboxSshTargetConfirmedRemoved(target)).resolves.toBe(false)
})
it('does not use a tombstone for a redirected SSH target', async () => {
  configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired: 'removed' } }])
  await expect(
    isSandboxSshTargetConfirmedRemoved({ ...target, host: 'other', configHost: 'other' })
  ).resolves.toBe(false)
  expect(run).not.toHaveBeenCalled()
})

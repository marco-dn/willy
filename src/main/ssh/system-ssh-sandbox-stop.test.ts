import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import { configureSandboxLifecycleGuard } from '../sandbox/sandbox-lifecycle-guard'
import { startSystemSshPortForwardProcess } from './system-transport/system-ssh-forward-process'
import { spawnSystemSsh, spawnSystemSshCommand } from './system-transport/system-ssh-command'

const { spawn, server } = vi.hoisted(() => ({ spawn: vi.fn(), server: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn, execFile: vi.fn() }))
vi.mock('@orca/process-host', () => ({ spawnProcess: spawn }))
vi.mock('node:net', () => ({ createServer: server, connect: vi.fn() }))
vi.mock('../sandbox/sandbox-command', () => ({ createSandboxCommand: vi.fn() }))
vi.mock('./system-transport/system-ssh-binary', () => ({ findSystemSsh: () => '/usr/bin/ssh' }))

const target = { id: 'ssh-demo', host: 'demo.sbx', label: 'demo', port: 22, username: 'agent' }
const record: ManagedSandbox = {
  name: 'demo',
  sandboxId: 'sandbox-demo',
  mountPath: '/shared',
  sshTargetId: target.id,
  tools: [],
  operationId: 'op',
  status: 'ready',
  stage: 'cleanup',
  updatedAt: 1,
  logs: [],
  versions: [],
  lifecycle: { desired: 'running' }
}
afterEach(() => {
  configureSandboxLifecycleGuard(() => [])
  vi.clearAllMocks()
})

it('does not spawn a tunnel when stop occurs while its local port is being reserved', async () => {
  const current = { ...record }
  configureSandboxLifecycleGuard(() => [current])
  const listener = Object.assign(new EventEmitter(), {
    listen: vi.fn(),
    address: () => ({ port: 45678 }),
    close: (callback: () => void) => callback()
  })
  server.mockReturnValue(listener)
  const pending = startSystemSshPortForwardProcess(target, 0, '127.0.0.1', 6768)
  current.lifecycle = { desired: 'stopped', pending: 'stop' }
  listener.emit('listening')
  await expect(pending).rejects.toThrow('stopped or removed')
  expect(spawn).not.toHaveBeenCalled()
})

it.each(['stopped', 'removed'] as const)('blocks independent SSH commands after %s', (desired) => {
  configureSandboxLifecycleGuard(() => [{ ...record, lifecycle: { desired } }])
  expect(() => spawnSystemSsh(target)).toThrow('stopped or removed')
  expect(() => spawnSystemSshCommand(target, 'true')).toThrow('stopped or removed')
  expect(spawn).not.toHaveBeenCalled()
})

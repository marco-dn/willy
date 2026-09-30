import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshTarget } from '../../shared/ssh-types'

const mocks = vi.hoisted(() => {
  const targets: SshTarget[] = []
  return {
    targets,
    run: vi.fn(),
    add: vi.fn(),
    connect: vi.fn(),
    getState: vi.fn()
  }
})
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../ssh/system-ssh-binary', () => ({ findSystemSsh: () => '/usr/bin/ssh' }))
vi.mock('../ssh/ssh-target-registry', () => ({
  getSshTargetRegistryStore: () => ({
    listTargets: () => mocks.targets,
    getTarget: (id: string) => mocks.targets.find((target) => target.id === id)
  }),
  connectRegisteredSshTarget: mocks.connect,
  getRegisteredSshState: mocks.getState
}))
vi.mock('../ipc/ssh-target-crud-handlers', () => ({ addRegisteredSshTarget: mocks.add }))
import { connectSandboxSshTarget, registerSandboxSshTarget } from './sandbox-ssh-target'

const target: SshTarget = {
  id: 'existing',
  label: 'My existing sandbox',
  configHost: 'demo.sbx',
  host: 'demo.sbx',
  port: 22,
  username: 'sandbox',
  proxyCommand: 'sbx ssh-proxy demo',
  source: 'manual'
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.targets = []
  mocks.run.mockResolvedValue({
    code: 0,
    timedOut: false,
    stdout: 'hostname demo.sbx\nuser sandbox\nport 22\nproxycommand sbx ssh-proxy demo\n',
    stderr: ''
  })
  mocks.add.mockReturnValue({ target: { ...target, id: 'new-target' }, repoReadoptions: [] })
  mocks.getState.mockReturnValue(undefined)
  mocks.connect.mockResolvedValue({ status: 'connected' })
})
describe('sandbox SSH registration', () => {
  it('reuses a matching target without overwriting its alias, label or proxy', async () => {
    mocks.targets = [target]
    expect(await registerSandboxSshTarget('demo.sbx')).toBe('existing')
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.targets[0]).toEqual(target)
  })
  it('registers resolved ProxyCommand and config alias through the existing target flow', async () => {
    expect(await registerSandboxSshTarget('demo.sbx')).toBe('new-target')
    expect(mocks.add).toHaveBeenCalledWith(
      expect.objectContaining({ configHost: 'demo.sbx', proxyCommand: target.proxyCommand })
    )
  })
  it('refuses a target redirected to another host', async () => {
    mocks.targets = [{ ...target, host: 'different.example' }]
    await expect(registerSandboxSshTarget('demo.sbx', 'existing')).rejects.toThrow('differs')
    expect(mocks.add).not.toHaveBeenCalled()
  })
  it('reuses a connected SSH session and reports incomplete connection attempts', async () => {
    mocks.getState.mockReturnValue({ status: 'connected' })
    await connectSandboxSshTarget('existing')
    expect(mocks.connect).not.toHaveBeenCalled()
    mocks.getState.mockReturnValue(undefined)
    mocks.connect.mockResolvedValue({ status: 'error' })
    await expect(connectSandboxSshTarget('existing')).rejects.toThrow('not ready')
  })
})

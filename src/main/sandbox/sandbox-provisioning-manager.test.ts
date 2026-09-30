import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SandboxSummary } from '../../shared/sandbox-types'
import type { SandboxProvisionRequest } from '../../shared/sandbox-provisioning-types'
import { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { SandboxProvisioningManager } from './sandbox-provisioning-manager'

const directories: string[] = []
afterEach(() => {
  for (const path of directories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'willy-sandbox-test-'))
  directories.push(dir)
  const store = new SandboxProvisioningStore(join(dir, 'state.json'))
  let inventory: SandboxSummary[] = []
  let rules: object[] = []
  const run = vi.fn(async (args: string[]) => {
    if (args[0] === 'exec') {
      return '12345678-1234-4234-8234-123456789abc'
    }
    if (args[0] === 'ls') {
      return JSON.stringify({ sandboxes: inventory })
    }
    if (args[0] === 'create') {
      inventory.push({
        id: 'sandbox-id',
        name: args[2],
        workspaces: [args[4]],
        agent: 'shell',
        status: 'stopped'
      })
    }
    if (args[1] === 'ls') {
      return JSON.stringify({ rules })
    }
    if (args[1] === 'check') {
      return '{"allowed":true}'
    }
    if (args[1] === 'allow') {
      rules = [
        {
          id: '11111111-1111-4111-8111-111111111111',
          scope: 'sandbox:demo',
          resource_type: 'network',
          decision: 'allow',
          resources: ['**'],
          actions: ['net:connect:tcp'],
          editable: true,
          layer: 'local'
        }
      ]
      return 'Rule added to policy local (scope: sandbox:demo): 11111111-1111-4111-8111-111111111111 (** [tcp])'
    }
    if (args[1] === 'rm') {
      rules = []
    }
    return ''
  })
  const dependencies = {
    command: async () => run,
    ssh: vi.fn(async (_alias: string, _script: string) =>
      ['python3', 'git', 'curl', 'node', 'npm', 'make', 'cc', 'just', 'zsh', 'uv']
        .map((tool) => `WILLY_TOOL ${tool} test-version`)
        .join('\n')
    ),
    registerTarget: vi.fn(async () => 'ssh-existing'),
    connectTarget: vi.fn(async () => {})
  }
  const manager = new SandboxProvisioningManager(store, dependencies)
  const request: SandboxProvisionRequest = {
    mode: 'create',
    name: 'demo',
    mountPath: dir,
    createMount: false,
    tools: ['uv']
  }
  const done = async () => {
    await vi.waitFor(() => expect(store.list()[0]?.status).not.toBe('provisioning'))
    return store.list()[0]
  }
  return {
    dir,
    store,
    manager,
    request,
    dependencies,
    run,
    done,
    setInventory: (next: SandboxSummary[]) => {
      inventory = next
    },
    rules: () => rules
  }
}
describe('sandbox provisioning', () => {
  it('creates, installs only selected tools, verifies and registers SSH', async () => {
    const f = fixture()
    await f.manager.provision(f.request)
    expect((await f.done()).status).toBe('ready')
    const scripts = f.dependencies.ssh.mock.calls.map((call) => String(call[1])).join('\n')
    expect(scripts).toContain('astral.sh')
    expect(scripts).not.toContain('claude.ai')
    expect(scripts).not.toContain('setup-cli')
    expect(f.store.list()[0].sshTargetId).toBe('ssh-existing')
    expect(f.rules()).toEqual([])
  })
  it('adopts without creating a duplicate and validates identity and mount', async () => {
    const f = fixture()
    f.setInventory([
      { id: 'adopt-id', name: 'demo', agent: 'shell', status: 'stopped', workspaces: [f.dir] }
    ])
    await expect(
      f.manager.provision({ ...f.request, mode: 'adopt', sandboxId: 'wrong' })
    ).rejects.toThrow('changed')
    await f.manager.provision({ ...f.request, mode: 'adopt', sandboxId: 'adopt-id' })
    expect((await f.done()).status).toBe('ready')
    expect(f.run.mock.calls.some(([args]) => args[0] === 'create')).toBe(false)
  })
  it('creates a missing directory only when explicitly requested', async () => {
    const f = fixture()
    const mountPath = join(f.dir, 'new folder')
    await expect(f.manager.provision({ ...f.request, mountPath })).rejects.toThrow()
    expect(existsSync(mountPath)).toBe(false)
    await f.manager.provision({ ...f.request, mountPath, createMount: true })
    expect((await f.done()).status).toBe('ready')
    expect(existsSync(mountPath)).toBe(true)
  })
  it('rejects unsafe names and relative paths before starting commands', async () => {
    const f = fixture()
    await expect(f.manager.provision({ ...f.request, name: '--bad' })).rejects.toThrow()
    await expect(f.manager.provision({ ...f.request, mountPath: 'relative' })).rejects.toThrow(
      'absolute'
    )
    expect(f.run).not.toHaveBeenCalled()
  })
  it('rejects concurrent operations and resumes after an installer error', async () => {
    const f = fixture()
    f.dependencies.ssh.mockRejectedValueOnce(new Error('SSH unavailable'))
    await f.manager.provision(f.request)
    await expect(f.manager.provision(f.request)).rejects.toThrow('Another sandbox operation')
    expect((await f.done()).status).toBe('error')
    await f.manager.provision({ ...f.request, mode: 'resume', tools: [] })
    expect((await f.done()).status).toBe('ready')
    expect(f.run.mock.calls.filter(([args]) => args[0] === 'create')).toHaveLength(1)
  })
  it('cleans temporary access after a remote installer failure', async () => {
    const f = fixture()
    f.dependencies.ssh.mockImplementation(async (_alias, script) => {
      if (script.includes('apt-get update')) {
        throw new Error('package installation failed')
      }
      return ''
    })
    await f.manager.provision(f.request)
    const record = await f.done()
    expect(record.status).toBe('error')
    expect(record.error).toContain('base:')
    expect(record.network).toBeUndefined()
    expect(f.rules()).toEqual([])
    expect(f.dependencies.registerTarget).not.toHaveBeenCalled()
  })
  it('reuses the saved SSH target when tools are reconfigured', async () => {
    const f = fixture()
    await f.manager.provision(f.request)
    await f.done()
    await f.manager.provision({ ...f.request, mode: 'resume', tools: [] })
    expect((await f.done()).status).toBe('ready')
    expect(f.dependencies.registerTarget).toHaveBeenLastCalledWith('demo.sbx', 'ssh-existing')
    expect(f.store.list()[0].tools).toEqual([])
  })
  it('does not recreate a removed or replaced managed sandbox', async () => {
    const f = fixture()
    await f.manager.provision(f.request)
    await f.done()
    f.setInventory([])
    await expect(f.manager.provision({ ...f.request, mode: 'resume' })).rejects.toThrow(
      'missing or has been replaced'
    )
  })
  it('persists incomplete work and requires explicit resume after restart', async () => {
    const f = fixture()
    await f.manager.provision(f.request)
    await f.done()
    const record = f.store.list()[0]
    record.status = 'provisioning'
    f.store.save(record)
    const freshStore = new SandboxProvisioningStore(join(f.dir, 'state.json'))
    const recovered = new SandboxProvisioningManager(freshStore, f.dependencies)
    expect((await recovered.list())[0].status).toBe('interrupted')
    expect(f.run.mock.calls.filter(([args]) => args[0] === 'create')).toHaveLength(1)
  })
})

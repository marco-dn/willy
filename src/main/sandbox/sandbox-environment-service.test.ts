import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SandboxEnvironmentService } from './sandbox-environment-service'
import { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { SandboxSshConfigurationError } from './sandbox-ssh-target'
import { SANDBOX_BASE_TOOLS } from './sandbox-installers'
import { parseSandboxEnvironmentProbe, sandboxEnvironmentProbe } from './sandbox-environment-probe'

const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })))
function probe(missing?: string) {
  return [
    'identity',
    'mount',
    'preparation',
    'certificates',
    'platform',
    'libc',
    ...SANDBOX_BASE_TOOLS,
    'flock'
  ]
    .map(
      (id) =>
        `WILLY_ENV ${id} ${id === missing ? 'missing' : 'ok'} ${Buffer.from(id === 'identity' ? 'uuid' : 'verified').toString('base64')}`
    )
    .join('\n')
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'willy-verify-'))
  dirs.push(dir)
  const file = join(dir, 'state.json')
  const records = new SandboxProvisioningStore(file)
  records.save({
    name: 'demo',
    sandboxId: 'uuid',
    mountPath: '/shared folder',
    tools: [],
    operationId: 'op',
    status: 'imported',
    stage: 'verify',
    logs: [],
    versions: [],
    updatedAt: 1
  })
  const target = { name: 'demo', id: 'uuid' }
  const inventory = { ...target, agent: 'shell', workspaces: ['/shared folder'], status: 'running' }
  const run = vi.fn(async (_args: string[]) => JSON.stringify({ sandboxes: [inventory] }))
  const release = vi.fn()
  const deps = {
    records,
    acquire: vi.fn(async () => ({ run, release })),
    inspectSsh: vi.fn(async () => undefined),
    ssh: vi.fn(async (_alias: string, _script: string) => probe()),
    relay: vi.fn(() => ({ id: 'relay', status: 'ok' as const, detail: 'compatible' })),
    registerTarget: vi.fn(async () => 'ssh-id'),
    changed: vi.fn()
  }
  return {
    file,
    inventory,
    target,
    run,
    release,
    deps,
    service: new SandboxEnvironmentService(deps)
  }
}
it('verifies without starting or installing, then persists the target and report', async () => {
  const f = fixture()
  const report = await f.service.verify(f.target)
  expect(report.outcome).toBe('ready')
  expect(f.run.mock.calls.length).toBeGreaterThan(0)
  for (const call of f.run.mock.calls) {
    expect(call).toEqual([['ls', '--json']])
  }
  expect(f.deps.registerTarget).toHaveBeenCalledWith('demo.sbx', undefined)
  expect(f.deps.ssh.mock.calls[0]?.[1]).not.toMatch(/apt-get|sbx |curl .*https:|mkdir|setup ssh/)
  expect(new SandboxProvisioningStore(f.file).list()[0]).toMatchObject({
    status: 'ready',
    sshTargetId: 'ssh-id',
    verification: report
  })
  expect(f.release).toHaveBeenCalledOnce()
})
it('requires explicit start before any SSH command', async () => {
  const f = fixture()
  f.inventory.status = 'stopped'
  expect(await f.service.verify(f.target)).toMatchObject({
    outcome: 'unavailable',
    canPrepare: false
  })
  expect(f.deps.ssh).not.toHaveBeenCalled()
  expect(f.deps.inspectSsh).not.toHaveBeenCalled()
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
})
it('offers preparation only for missing SSH configuration', async () => {
  const f = fixture()
  f.deps.inspectSsh.mockRejectedValue(new SandboxSshConfigurationError('missing', 'Missing alias'))
  expect(await f.service.verify(f.target)).toMatchObject({
    outcome: 'needs-preparation',
    canPrepare: true
  })
  expect(f.deps.ssh).not.toHaveBeenCalled()
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
})
it('reports missing tools without installing them or registering a target', async () => {
  const f = fixture()
  f.deps.ssh.mockResolvedValue(probe('just'))
  expect(await f.service.verify(f.target)).toMatchObject({
    outcome: 'needs-preparation',
    checks: expect.arrayContaining([{ id: 'just', status: 'missing', detail: 'verified' }])
  })
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
  expect(f.deps.records.list()[0].status).toBe('imported')
})
it.each(['daemon', 'ssh', 'identity', 'mount', 'probe', 'registration'])(
  'does not certify an environment after %s failure',
  async (failure) => {
    const f = fixture()
    if (failure === 'daemon') {
      f.run.mockRejectedValue(new Error('Daemon unavailable'))
    }
    if (failure === 'ssh') {
      f.deps.ssh.mockRejectedValue(new Error('Connection refused'))
    }
    if (failure === 'identity') {
      f.inventory.id = 'other'
    }
    if (failure === 'mount') {
      f.inventory.workspaces = ['/other']
    }
    if (failure === 'probe') {
      f.deps.ssh.mockResolvedValue('unexpected output')
    }
    if (failure === 'registration') {
      f.deps.registerTarget.mockRejectedValue(new Error('Target conflict'))
    }
    expect(await f.service.verify(f.target)).toMatchObject({
      outcome: 'unavailable',
      canPrepare: false
    })
    expect(f.deps.records.list()[0].status).toBe('imported')
    expect(f.release).toHaveBeenCalledOnce()
  }
)
it('rechecks inventory after the probe and rejects an intervening stop', async () => {
  const f = fixture()
  f.deps.ssh.mockImplementation(async () => {
    f.inventory.status = 'stopped'
    return probe()
  })
  expect((await f.service.verify(f.target)).outcome).toBe('unavailable')
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
})
it('rejects a concurrent operation before probing', async () => {
  const f = fixture()
  f.deps.acquire.mockRejectedValue(new Error('Operation already running'))
  await expect(f.service.verify(f.target)).rejects.toThrow('already running')
  expect(f.deps.ssh).not.toHaveBeenCalled()
})
it('rejects partial or duplicated probe output', () => {
  expect(() => parseSandboxEnvironmentProbe(`${probe()}\n${probe()}`, [])).toThrow('duplicate')
  expect(() =>
    parseSandboxEnvironmentProbe(probe().split('\n').slice(0, -1).join('\n'), [])
  ).toThrow('flock')
})
it('quotes paths and UUIDs without introducing provisioning commands', () => {
  const script = sandboxEnvironmentProbe('uuid', "/shared folder/it's here", [])
  expect(script).toContain("'/shared folder/it'\\''s here'")
  expect(script).not.toMatch(/apt-get|mkdir|sbx exec|setup ssh/)
  expect(script).toContain('timeout 5')
})

it('rejects an SSH alias that reaches another UUID even when inventory is unchanged', async () => {
  const f = fixture()
  f.deps.ssh.mockResolvedValue(
    probe().replace(
      Buffer.from('uuid').toString('base64'),
      Buffer.from('another-uuid').toString('base64')
    )
  )
  expect(await f.service.verify(f.target)).toMatchObject({
    outcome: 'unavailable',
    canPrepare: false
  })
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
  expect(f.deps.relay).not.toHaveBeenCalled()
})
it('persists a failed recheck without losing the previously registered target', async () => {
  const f = fixture()
  await f.service.verify(f.target)
  f.deps.ssh.mockRejectedValue(new Error('SSH disconnected'))
  await f.service.verify(f.target)
  expect(new SandboxProvisioningStore(f.file).list()[0]).toMatchObject({
    status: 'ready',
    sshTargetId: 'ssh-id',
    verification: { outcome: 'unavailable', canPrepare: false }
  })
})
it('preserves explicit stop intent even when inventory still reports running', async () => {
  const f = fixture()
  const record = f.deps.records.list()[0]
  f.deps.records.save({ ...record, lifecycle: { desired: 'stopped' } })
  expect((await f.service.verify(f.target)).outcome).toBe('unavailable')
  expect(f.deps.ssh).not.toHaveBeenCalled()
})

it('does not certify an interrupted environment while earlier preparation is unverifiable', async () => {
  const f = fixture()
  const record = f.deps.records.list()[0]
  f.deps.records.save({ ...record, status: 'interrupted' })
  f.deps.ssh.mockResolvedValue(probe('preparation'))
  expect(await f.service.verify(f.target)).toMatchObject({
    outcome: 'unavailable',
    canPrepare: false
  })
  expect(f.deps.records.list()[0].status).toBe('interrupted')
  expect(f.deps.registerTarget).not.toHaveBeenCalled()
  expect(f.deps.relay).not.toHaveBeenCalled()
})

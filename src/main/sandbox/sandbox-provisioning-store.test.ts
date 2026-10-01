import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import { SandboxProvisioningStore, provisionRequestSchema } from './sandbox-provisioning-store'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})
describe('sandbox persistence validation', () => {
  it.each(['{broken', '{"version":99,"records":[]}'])(
    'does not overwrite unreadable or unsupported saved data',
    (input) => {
      const dir = mkdtempSync(join(tmpdir(), 'willy-store-'))
      dirs.push(dir)
      const file = join(dir, 'state.json')
      writeFileSync(file, input)
      expect(() => new SandboxProvisioningStore(file)).toThrow()
      expect(readFileSync(file, 'utf8')).toBe(input)
    }
  )
  it('loads pre-lifecycle records and persists lifecycle intent without losing recovery data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'willy-store-'))
    dirs.push(dir)
    const file = join(dir, 'state.json')
    const legacy: ManagedSandbox = {
      name: 'legacy-sandbox',
      mountPath: '/shared folder',
      sandboxId: 'sandbox-id',
      sshTargetId: 'ssh-target',
      tools: ['uv'],
      operationId: 'operation',
      status: 'interrupted',
      stage: 'cleanup',
      updatedAt: 1,
      logs: ['cleanup'],
      versions: [],
      network: { beforeIds: ['inherited'], createdIds: ['temporary'], pending: false }
    }
    writeFileSync(file, JSON.stringify({ version: 1, records: [legacy] }))
    const store = new SandboxProvisioningStore(file)
    expect(store.list()).toEqual([legacy])
    const stopped: ManagedSandbox = {
      ...legacy,
      lifecycle: { desired: 'stopped', pending: 'stop', error: 'Daemon unavailable' }
    }
    store.save(stopped)
    expect(new SandboxProvisioningStore(file).list()).toEqual([stopped])
    const detached = store.list()
    detached[0].network?.createdIds.push('unowned')
    expect(store.list()).toEqual([stopped])
  })
  it('rejects arbitrary scripts, tool names, secrets and control characters at the IPC boundary', () => {
    const request = {
      mode: 'create',
      name: 'demo',
      mountPath: '/work',
      createMount: false,
      tools: ['uv']
    }
    expect(provisionRequestSchema.safeParse({ ...request, script: 'arbitrary' }).success).toBe(
      false
    )
    expect(provisionRequestSchema.safeParse({ ...request, token: 'secret' }).success).toBe(false)
    expect(
      provisionRequestSchema.safeParse({ ...request, tools: ['custom-command'] }).success
    ).toBe(false)
    expect(
      provisionRequestSchema.safeParse({ ...request, mountPath: '/work\nother' }).success
    ).toBe(false)
  })
})

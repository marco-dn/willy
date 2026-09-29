import { describe, expect, it, vi } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/process-spec'
import { inspectLocalSandboxes } from './sbx-inspection'
import { parseSbxInventory, parseSbxVersion } from './sbx-response'

const sandbox = {
  id: 'sandbox-1',
  name: 'demo',
  agent: 'shell',
  status: 'running',
  workspaces: ['/work/demo']
}
const version = { client: { version: 'v0.45.1' }, server: { state: 'running', version: 'v0.45.1' } }
const success = (value: unknown): ProcessResult => ({
  code: 0,
  signal: null,
  timedOut: false,
  stdout: JSON.stringify(value),
  stderr: ''
})

function dependencies(...results: ProcessResult[]) {
  const run = vi.fn<(spec: ProcessSpec) => Promise<ProcessResult>>()
  for (const result of results) {
    run.mockResolvedValueOnce(result)
  }
  return { resolveCommand: vi.fn().mockResolvedValue('/tools/sbx'), run }
}

describe('sbx response parsing', () => {
  it('accepts additive fields and preserves unfamiliar observed states', () => {
    expect(
      parseSbxInventory(
        JSON.stringify({ sandboxes: [{ ...sandbox, status: 'starting', extra: true }] })
      ).sandboxes[0]?.status
    ).toBe('starting')
    expect(parseSbxVersion(JSON.stringify({ ...version, extra: true })).client.version).toBe(
      'v0.45.1'
    )
  })

  it('accepts an empty inventory and a sandbox without mounts', () => {
    expect(parseSbxInventory('{"sandboxes":[]}').sandboxes).toEqual([])
    expect(
      parseSbxInventory(JSON.stringify({ sandboxes: [{ ...sandbox, workspaces: undefined }] }))
        .sandboxes[0]?.workspaces
    ).toEqual([])
  })

  it.each(['not json', '{}', '{"sandboxes":null}', '{"sandboxes":[{}]}'])(
    'rejects invalid inventories instead of reporting empty: %s',
    (input) => {
      expect(() => parseSbxInventory(input)).toThrow()
    }
  )
})

describe('local sandbox inspection', () => {
  it('uses only bounded, read-only commands through the resolved executable', async () => {
    const deps = dependencies(success(version), success({ sandboxes: [sandbox] }))
    expect(await inspectLocalSandboxes(deps)).toEqual({
      status: 'ready',
      cliPath: '/tools/sbx',
      clientVersion: 'v0.45.1',
      serverVersion: 'v0.45.1',
      serverState: 'running',
      sandboxes: [sandbox]
    })
    expect(deps.resolveCommand).toHaveBeenCalledWith('sbx', { searchCurrentDirectory: false })
    expect(deps.run.mock.calls.map(([spec]) => spec.args)).toEqual([
      ['version', '--json'],
      ['ls', '--json']
    ])
    expect(deps.run).toHaveBeenCalledWith(
      expect.objectContaining({
        program: '/tools/sbx',
        timeoutMs: 15_000,
        maxOutputBytes: 1024 * 1024
      })
    )
  })

  it('does not run anything when sbx is missing', async () => {
    const deps = dependencies()
    deps.resolveCommand.mockResolvedValue(null)
    expect(await inspectLocalSandboxes(deps)).toMatchObject({
      status: 'error',
      reason: 'cli-missing'
    })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('reports an unavailable daemon separately from an empty inventory', async () => {
    const deps = dependencies(success({ client: version.client, server: { state: 'stopped' } }))
    expect(await inspectLocalSandboxes(deps)).toMatchObject({
      status: 'error',
      reason: 'service-unavailable',
      clientVersion: 'v0.45.1'
    })
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ ...success({}), timedOut: true }, 'timeout'],
    [{ ...success({}), code: 1, stderr: 'daemon unavailable' }, 'command-failed'],
    [{ ...success({}), outputTruncated: true }, 'invalid-response'],
    [success({}), 'invalid-response']
  ] as const)('preserves CLI diagnostics on an inventory failure', async (result, reason) => {
    const deps = dependencies(success(version), result)
    expect(await inspectLocalSandboxes(deps)).toMatchObject({
      status: 'error',
      reason,
      clientVersion: 'v0.45.1'
    })
  })

  it('reports launch failures without throwing across IPC', async () => {
    const deps = dependencies()
    deps.run.mockRejectedValue(new Error('permission denied'))
    expect(await inspectLocalSandboxes(deps)).toMatchObject({
      status: 'error',
      reason: 'command-failed',
      detail: 'permission denied'
    })
  })

  it('does not retain stale inventories across refreshes', async () => {
    const deps = dependencies(
      success(version),
      success({ sandboxes: [sandbox] }),
      success(version),
      success({ sandboxes: [] })
    )
    await inspectLocalSandboxes(deps)
    expect(await inspectLocalSandboxes(deps)).toMatchObject({ status: 'ready', sandboxes: [] })
  })
})

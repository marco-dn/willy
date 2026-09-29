import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandboxInspection } from '../../shared/sandbox-types'

const mocks = vi.hoisted(() => ({ handle: vi.fn(), removeHandler: vi.fn(), inspect: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: mocks.handle, removeHandler: mocks.removeHandler }
}))
vi.mock('../sandbox/sbx-inspection', () => ({ inspectLocalSandboxes: mocks.inspect }))
import { registerSandboxHandlers } from './sandboxes'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('sandbox IPC registration', () => {
  it('shares concurrent inspections and rechecks on the next request', async () => {
    let inspectHandler: (() => Promise<SandboxInspection>) | undefined
    mocks.handle.mockImplementation(
      (_channel: string, handler: () => Promise<SandboxInspection>) => {
        inspectHandler = handler
      }
    )
    const result: SandboxInspection = {
      cliPath: null,
      clientVersion: null,
      serverVersion: null,
      serverState: null,
      status: 'error',
      reason: 'cli-missing',
      detail: ''
    }
    mocks.inspect.mockResolvedValue(result)
    registerSandboxHandlers()
    const first = inspectHandler?.()
    const concurrent = inspectHandler?.()
    expect(first).toBeDefined()
    expect(first).toBe(concurrent)
    expect(mocks.inspect).toHaveBeenCalledTimes(1)
    expect(await first).toEqual(result)
    await inspectHandler?.()
    expect(mocks.inspect).toHaveBeenCalledTimes(2)
    registerSandboxHandlers()
    expect(mocks.removeHandler).toHaveBeenCalledWith('sandboxes:inspect')
    expect(mocks.handle.mock.calls.map(([channel]) => channel)).toEqual([
      'sandboxes:inspect',
      'sandboxes:inspect'
    ])
  })
})

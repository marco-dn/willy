import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn(), resolve: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../ipc/command-path-resolver', () => ({ resolveCommandOnLocalPath: mocks.resolve }))
import { createSandboxCommand } from './sandbox-command'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue('/tools/sbx')
})
describe('sbx policy exit status', () => {
  it('accepts exit 1 only when explicitly expected for policy evaluation', async () => {
    mocks.run.mockResolvedValue({
      code: 1,
      stdout: '{"allowed":false}',
      stderr: '',
      timedOut: false
    })
    const run = await createSandboxCommand()
    expect(await run(['policy', 'check'], { expectedExitCodes: [0, 1] })).toBe('{"allowed":false}')
    await expect(run(['policy', 'allow'])).rejects.toThrow('failed')
  })
  it('never accepts timeout or clipped JSON as a policy result', async () => {
    const run = await createSandboxCommand()
    mocks.run.mockResolvedValue({ code: 1, stdout: '', stderr: '', timedOut: true })
    await expect(run(['policy', 'check'], { expectedExitCodes: [0, 1] })).rejects.toThrow('timeout')
    mocks.run.mockResolvedValue({
      code: 0,
      stdout: '{}',
      stderr: '',
      timedOut: false,
      outputTruncated: true
    })
    await expect(run(['policy', 'ls'])).rejects.toThrow('failed')
  })
})

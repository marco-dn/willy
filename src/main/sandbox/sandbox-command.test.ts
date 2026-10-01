import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ run: vi.fn(), resolve: vi.fn() }))
vi.mock('../../shared/child-process/run-process', () => ({ runProcess: mocks.run }))
vi.mock('../ipc/command-path-resolver', () => ({ resolveCommandOnLocalPath: mocks.resolve }))
vi.mock('../ssh/system-ssh-binary', () => ({ findSystemSsh: () => '/usr/bin/ssh' }))
import { createSandboxCommand, runSandboxSsh } from './sandbox-command'
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

it('bounds read-only verification and rejects clipped results', async () => {
  mocks.run.mockResolvedValue({ code: 0, stdout: 'x'.repeat(20_000), stderr: '', timedOut: false })
  expect(await runSandboxSsh('demo.sbx', 'probe', { verification: true })).toHaveLength(20_000)
  expect(mocks.run).toHaveBeenCalledWith(
    expect.objectContaining({
      timeoutMs: 90_000,
      input: 'probe',
      args: expect.arrayContaining(['BatchMode=yes', 'demo.sbx', 'bash -s'])
    })
  )
  mocks.run.mockResolvedValue({ code: 0, stdout: 'partial', stderr: '', outputTruncated: true })
  await expect(runSandboxSsh('demo.sbx', 'probe', { verification: true })).rejects.toThrow(
    'verification failed'
  )
})

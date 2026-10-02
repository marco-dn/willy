import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runLocalSourceControlPlan } from './source-control-local-process'
import { discoverModelsLocal } from './commit-message-model-discovery'
import { SOURCE_CONTROL_GENERATION_TIMEOUT_MS } from './source-control-generation-limits'
import { createMockDiscoveryChild } from './commit-message-text-generation-test-harness'

const { acquireMock, releaseMock } = vi.hoisted(() => ({
  acquireMock: vi.fn(),
  releaseMock: vi.fn()
}))

vi.mock('../sandbox/sandbox-execution-boundary', () => ({
  acquireSandboxLocalExecution: acquireMock
}))

function run(spawnAgent: Parameters<typeof runLocalSourceControlPlan>[0]['spawnAgent']) {
  return runLocalSourceControlPlan({
    plan: { binary: 'agent', args: [], stdinPayload: 'prompt', label: 'agent' },
    cwd: '/repo',
    env: undefined,
    emptyResultName: 'commit message',
    operation: 'commit-message',
    holdHomeLockUntilExit: false,
    spawnAgent
  })
}

beforeEach(() => {
  acquireMock.mockReset().mockReturnValue(releaseMock)
  releaseMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('local source-control agents inside a sandbox project', () => {
  it('claims the project for the cwd and releases it when the child closes', async () => {
    const child = createMockDiscoveryChild()
    const execution = run(() => child as never)

    expect(acquireMock).toHaveBeenCalledWith('/repo')
    child.stdout.emit('data', Buffer.from('Add README note\n'))
    child.emit('close', 0)

    await expect(execution.result).resolves.toMatchObject({ success: true })
    await execution.processClosed
    expect(releaseMock).toHaveBeenCalledOnce()
  })

  it('releases the claim when a timed-out child ignores the kill and never closes', async () => {
    vi.useFakeTimers()
    const child = createMockDiscoveryChild()
    const execution = run(() => child as never)

    await vi.advanceTimersByTimeAsync(SOURCE_CONTROL_GENERATION_TIMEOUT_MS)

    await expect(execution.result).resolves.toMatchObject({ success: false })
    await execution.processClosed
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(releaseMock).toHaveBeenCalledOnce()
  })

  it('reports a refused sandbox claim without spawning the agent', async () => {
    acquireMock.mockImplementation(() => {
      throw new Error('Sandbox is stopped.')
    })
    const spawnAgent = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const execution = run(spawnAgent)

    await expect(execution.result).resolves.toMatchObject({ success: false })
    expect(spawnAgent).not.toHaveBeenCalled()
    expect(releaseMock).not.toHaveBeenCalled()
  })

  it('claims model discovery for its cwd and releases it when discovery settles', async () => {
    const child = createMockDiscoveryChild()
    const pending = discoverModelsLocal({
      agentId: 'cursor',
      env: undefined,
      options: { cwd: '/repo' },
      backslash: 'escape',
      spawnAgent: () => child as never
    })

    expect(acquireMock).toHaveBeenCalledWith('/repo')
    child.emit('close', 0)
    await pending

    await vi.waitFor(() => expect(releaseMock).toHaveBeenCalledOnce())
  })
})

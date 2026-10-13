// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandboxInspection } from '../../../../shared/sandbox-types'
import { SandboxPane } from './SandboxPane'

const inspect = vi.fn<() => Promise<SandboxInspection>>()
const repoListeners = new Set<() => void>()
const notifyReposChanged = () => {
  for (const listener of repoListeners) {
    listener()
  }
}
const ready: SandboxInspection = {
  status: 'ready',
  cliPath: '/tools/sbx',
  clientVersion: 'v0.45.1',
  serverVersion: 'v0.45.1',
  serverState: 'running',
  sandboxes: [
    {
      id: 'demo',
      name: 'demo-sandbox',
      agent: 'shell',
      status: 'running',
      workspaces: ['/work/demo']
    }
  ]
}

beforeEach(() => {
  inspect.mockReset()
  repoListeners.clear()
  vi.stubGlobal('api', {
    sandboxes: { inspect, listManaged: vi.fn().mockResolvedValue([]) },
    repos: {
      onChanged: (callback: () => void) => {
        repoListeners.add(callback)
        return () => {
          repoListeners.delete(callback)
        }
      }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SandboxPane', () => {
  it('shows observed sandbox names, mounts, states and versions', async () => {
    inspect.mockResolvedValue(ready)
    render(<SandboxPane />)
    expect(await screen.findByText('demo-sandbox')).toBeTruthy()
    expect(screen.getByText('/work/demo')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    fireEvent.click(screen.getByText('Diagnostic details'))
    expect(screen.getByText('sbx CLI: v0.45.1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
  })

  it('refreshes diagnostics after lifecycle changes without dropping an in-flight update', async () => {
    inspect.mockResolvedValueOnce(ready)
    render(<SandboxPane />)
    await screen.findByText('Running')
    const stopping = Promise.withResolvers<SandboxInspection>()
    inspect.mockReturnValueOnce(stopping.promise).mockResolvedValueOnce({
      ...ready,
      sandboxes: ready.sandboxes.map((sandbox) => ({ ...sandbox, status: 'stopped' }))
    })
    act(() => notifyReposChanged())
    act(() => notifyReposChanged())
    await act(async () => {
      stopping.resolve(ready)
    })
    expect(await screen.findByText('Stopped')).toBeTruthy()
    expect(screen.queryByText('Running')).toBeNull()
    expect(inspect).toHaveBeenCalledTimes(3)
  })

  it('shows an empty state only after a successful inventory', async () => {
    inspect.mockResolvedValue({ ...ready, sandboxes: [] })
    render(<SandboxPane />)
    expect(await screen.findByText('No local sandboxes found.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers installation guidance when the CLI is missing', async () => {
    inspect.mockResolvedValue({
      cliPath: null,
      clientVersion: null,
      serverVersion: null,
      serverState: null,
      status: 'error',
      reason: 'cli-missing',
      detail: ''
    })
    render(<SandboxPane />)
    expect((await screen.findByRole('alert')).textContent).toContain('Install Docker Sandboxes')
    expect(
      screen.getByRole('link', { name: 'Docker Sandboxes installation guide' }).getAttribute('href')
    ).toBe('https://docs.docker.com/ai/sandboxes/install/')
    expect(screen.queryByText('No local sandboxes found.')).toBeNull()
  })

  it('does not present old observations as current after a failed refresh', async () => {
    inspect.mockResolvedValueOnce(ready).mockResolvedValueOnce({
      cliPath: '/tools/sbx',
      clientVersion: null,
      serverVersion: null,
      serverState: null,
      status: 'error',
      reason: 'timeout',
      detail: 'sbx version --json'
    })
    render(<SandboxPane />)
    await screen.findByText('demo-sandbox')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect((await screen.findByRole('alert')).textContent).toContain('did not respond in time')
    expect(screen.queryByText('demo-sandbox')).toBeNull()
    expect(screen.queryByText('No local sandboxes found.')).toBeNull()
  })

  it('disables refresh while checking and recovers from IPC failure', async () => {
    let resolveInspection: ((result: SandboxInspection) => void) | undefined
    inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInspection = resolve
        })
    )
    render(<SandboxPane />)
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Checking local sbx…')).toBeTruthy()
    resolveInspection?.(ready)
    await screen.findByText('demo-sandbox')
    inspect.mockRejectedValueOnce(new Error('IPC unavailable'))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load sandbox diagnostics'
    )
    inspect.mockResolvedValueOnce({ ...ready, sandboxes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await screen.findByText('No local sandboxes found.')).toBeTruthy()
  })
})

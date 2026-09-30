// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandboxInspection } from '../../../../shared/sandbox-types'
import { SandboxPane } from './SandboxPane'

const inspect = vi.fn<() => Promise<SandboxInspection>>()
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
  vi.stubGlobal('api', { sandboxes: { inspect, listManaged: vi.fn().mockResolvedValue([]) } })
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
    expect(screen.getByText('sbx CLI: v0.45.1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
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
    expect(screen.getByRole('status').textContent).toContain('Checking local sbx')
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

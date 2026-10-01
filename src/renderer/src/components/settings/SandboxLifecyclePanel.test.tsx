// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SandboxLifecyclePanel } from './SandboxLifecyclePanel'
const snapshot = vi.fn()
const lifecycle = vi.fn()
let notifyReposChanged = () => {}
const target = { name: 'demo', id: 'id' }
const projects = [
  { id: 'p1', name: 'First', linked: true },
  { id: 'p2', name: 'Second', linked: true }
]
beforeEach(() => {
  snapshot.mockReset().mockResolvedValue({ state: 'running', projects })
  lifecycle.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('api', {
    sandboxes: { lifecycleSnapshot: snapshot, lifecycle },
    repos: {
      onChanged: (callback: () => void) => {
        notifyReposChanged = callback
        return () => {
          notifyReposChanged = () => {}
        }
      }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('sandbox lifecycle controls', () => {
  it('shows every affected project and waits for explicit stop confirmation', async () => {
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Stop sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Stop sandbox' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('First')).toBeTruthy()
    expect(within(dialog).getByText('Second')).toBeTruthy()
    expect(lifecycle).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() =>
      expect(lifecycle).toHaveBeenCalledWith({
        target,
        action: 'stop',
        confirmedProjectIds: ['p1', 'p2']
      })
    )
  })
  it('disables removal while any project is linked', async () => {
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    await screen.findByText('Running')
    expect(screen.getByRole('button', { name: 'Remove sandbox' }).hasAttribute('disabled')).toBe(
      true
    )
    expect(screen.getByText('Unlink all projects before removing this sandbox.')).toBeTruthy()
  })
  it('requires the exact sandbox name and sends only the selected target', async () => {
    snapshot.mockResolvedValue({ state: 'stopped', projects: [] })
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    await screen.findByText('Stopped')
    fireEvent.click(screen.getByRole('button', { name: 'Remove sandbox' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Type the sandbox name to confirm'), {
      target: { value: 'demo' }
    })
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(lifecycle).toHaveBeenCalledWith({
        target,
        action: 'remove',
        confirmedProjectIds: [],
        confirmName: 'demo'
      })
    )
  })
  it('does not perform an operation after cancelling', async () => {
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    await screen.findByText('Running')
    fireEvent.click(screen.getByRole('button', { name: 'Stop sandbox' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(lifecycle).not.toHaveBeenCalled()
  })
  it('shows an unavailable service as an error rather than a missing sandbox', async () => {
    snapshot.mockRejectedValue(new Error('Daemon unavailable'))
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Daemon unavailable')
    expect(screen.queryByText('Removed outside Willy')).toBeNull()
  })
  it('enables removal immediately after all projects are unlinked elsewhere in Settings', async () => {
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    await screen.findByText('Running')
    const remove = screen.getByRole('button', { name: 'Remove sandbox' })
    expect(remove.hasAttribute('disabled')).toBe(true)
    snapshot.mockResolvedValue({
      state: 'running',
      projects: projects.map((project) => ({ ...project, linked: false }))
    })
    act(() => notifyReposChanged())
    await waitFor(() => expect(remove.hasAttribute('disabled')).toBe(false))
    expect(screen.queryByText('Unlink all projects before removing this sandbox.')).toBeNull()
  })
  it('does not restore stale links when an older refresh finishes late', async () => {
    const old = Promise.withResolvers<{ state: string; projects: typeof projects }>()
    snapshot.mockReturnValueOnce(old.promise)
    render(<SandboxLifecyclePanel target={target} disabled={false} />)
    snapshot.mockResolvedValue({ state: 'running', projects: [] })
    act(() => notifyReposChanged())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Remove sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    await act(async () => old.resolve({ state: 'running', projects }))
    expect(screen.getByRole('button', { name: 'Remove sandbox' }).hasAttribute('disabled')).toBe(
      false
    )
  })
})

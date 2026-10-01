// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { SandboxCatalog } from './SandboxCatalog'

const listManaged = vi.fn<() => Promise<ManagedSandbox[]>>()
const provision = vi.fn()
const importExisting = vi.fn()
const lifecycleSnapshot = vi.fn()
const listeners = new Set<() => void>()
const record: ManagedSandbox = {
  name: 'demo',
  mountPath: '/work/with spaces',
  sandboxId: 'id',
  operationId: 'op',
  tools: ['uv'],
  status: 'provisioning',
  stage: 'base',
  updatedAt: 1,
  logs: ['Installing base'],
  versions: []
}
beforeEach(() => {
  listeners.clear()
  importExisting.mockReset()
  listManaged.mockReset().mockResolvedValue([])
  provision.mockReset().mockResolvedValue(record)
  lifecycleSnapshot.mockReset().mockResolvedValue({ state: 'running', projects: [] })
  vi.stubGlobal('api', {
    sandboxes: {
      listManaged,
      provision,
      importExisting,
      lifecycleSnapshot
    },
    projects: { list: vi.fn().mockResolvedValue([]) },
    repos: {
      pickFolder: vi.fn().mockResolvedValue('/work/chosen'),
      onChanged: (callback: () => void) => {
        listeners.add(callback)
        return () => {
          listeners.delete(callback)
        }
      }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('sandbox provisioning UI', () => {
  it('distinguishes installed tools from a stopped sandbox before the version output', async () => {
    listManaged.mockResolvedValue([{ ...record, status: 'ready', versions: ['uv 0.9.26'] }])
    lifecycleSnapshot.mockResolvedValue({ state: 'stopped', projects: [] })
    render(<SandboxCatalog available sandboxes={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open demo' }))
    expect(await screen.findByText('Tools installed')).toBeTruthy()
    fireEvent.click(screen.getByText('Tools installed'))
    const stopped = await screen.findByText('Stopped')
    expect(screen.queryByText('Ready')).toBeNull()
    expect(
      stopped.compareDocumentPosition(screen.getByText('uv 0.9.26')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stop sandbox' }).hasAttribute('disabled')).toBe(true)
  })
  it('lists each UUID once and removes active progress after preparation finishes', async () => {
    listManaged.mockResolvedValue([record])
    const observed = {
      id: 'id',
      name: 'demo',
      agent: 'shell',
      status: 'running',
      workspaces: [record.mountPath]
    }
    render(<SandboxCatalog available sandboxes={[observed]} />)
    await screen.findByText('Preparing')
    expect(screen.getAllByText('demo')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Open demo' }))
    expect(screen.getByText('Phase: Install required base')).toBeTruthy()
    listManaged.mockResolvedValue([{ ...record, status: 'ready' }])
    act(() => {
      for (const listener of listeners) {
        listener()
      }
    })
    await screen.findByText('Configured')
    expect(screen.queryByText('Phase: Install required base')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close demo details' }))
    expect(screen.getAllByText('demo')).toHaveLength(1)
    expect(screen.queryByText('Preparing')).toBeNull()
  })
  it('expands details within the list and keeps other sandboxes visible', async () => {
    listManaged.mockResolvedValue([{ ...record, status: 'ready' }])
    render(
      <SandboxCatalog
        available
        sandboxes={[
          {
            id: 'id',
            name: 'demo',
            agent: 'shell',
            status: 'running',
            workspaces: [record.mountPath]
          },
          {
            id: 'second',
            name: 'other-sandbox',
            agent: 'shell',
            status: 'stopped',
            workspaces: ['/other']
          }
        ]}
      />
    )
    await screen.findByText('Configured')
    fireEvent.click(await screen.findByRole('button', { name: 'Open demo' }))
    expect(
      screen.getByRole('button', { name: 'Close demo details' }).getAttribute('aria-expanded')
    ).toBe('true')
    expect(screen.getByText('other-sandbox')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New sandbox' })).toBeTruthy()
    expect(screen.getAllByText('demo')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Resume / configure' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close demo details' }))
    expect(screen.getByRole('button', { name: 'Open demo' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
    expect(screen.queryByRole('button', { name: 'Resume / configure' })).toBeNull()
    expect(screen.getByText('other-sandbox')).toBeTruthy()
  })
  it('groups managed sandboxes first even when an external name sorts before them', async () => {
    listManaged.mockResolvedValue([{ ...record, name: 'z-managed', status: 'ready' }])
    render(
      <SandboxCatalog
        available
        sandboxes={[
          {
            id: 'id',
            name: 'z-managed',
            agent: 'shell',
            status: 'stopped',
            workspaces: [record.mountPath]
          },
          {
            id: 'external',
            name: 'a-external',
            agent: 'shell',
            status: 'stopped',
            workspaces: ['/external']
          }
        ]}
      />
    )
    const managed = await screen.findByRole('region', { name: 'Managed by Willy' })
    const external = screen.getByRole('region', { name: 'External' })
    expect(
      managed.compareDocumentPosition(external) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(within(managed).getByText('z-managed')).toBeTruthy()
    expect(within(managed).queryByText('a-external')).toBeNull()
    expect(within(external).getByText('a-external')).toBeTruthy()
  })
  it('keeps saved sandboxes visible without claiming removal on a service error', async () => {
    listManaged.mockResolvedValue([{ ...record, status: 'ready' }])
    render(<SandboxCatalog available={false} sandboxes={[]} />)
    expect(await screen.findByText('demo')).toBeTruthy()
    expect(screen.getByText('State unavailable')).toBeTruthy()
    expect(screen.queryByText('Removed outside Willy')).toBeNull()
    expect(screen.queryByText('No local sandboxes found.')).toBeNull()
  })
  it('defaults to all optional tools and sends the explicit folder creation choice', async () => {
    render(<SandboxCatalog available sandboxes={[]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'New sandbox' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('Shared folder on this computer'), {
      target: { value: '/work/with spaces' }
    })
    fireEvent.click(screen.getByLabelText('Create this folder if it does not exist'))
    fireEvent.click(screen.getByLabelText('Claude Code'))
    fireEvent.click(screen.getByLabelText('Databricks CLI'))
    listManaged.mockResolvedValue([record])
    fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith({
        mode: 'create',
        name: 'demo',
        mountPath: '/work/with spaces',
        createMount: true,
        tools: ['uv', 'codex', 'orca-skills']
      })
    )
    expect(await screen.findByText('Phase: Install required base')).toBeTruthy()
    expect(screen.queryByLabelText('Name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close demo details' }))
    expect(screen.getAllByText('demo')).toHaveLength(1)
  })
  it('imports an external sandbox inline without provisioning and leaves projects unverified', async () => {
    const imported: ManagedSandbox = { ...record, status: 'imported', tools: [], logs: [] }
    importExisting.mockImplementation(async () => {
      listManaged.mockResolvedValue([imported])
      for (const listener of listeners) {
        listener()
      }
      await waitFor(() => expect(screen.getByText('Verification required')).toBeTruthy())
      return imported
    })
    lifecycleSnapshot.mockResolvedValue({ state: 'stopped', projects: [] })
    render(
      <SandboxCatalog
        available
        sandboxes={[
          {
            id: 'id',
            name: 'demo',
            agent: 'shell',
            status: 'stopped',
            workspaces: [record.mountPath]
          }
        ]}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open demo' }).hasAttribute('disabled')).toBe(false)
    )
    fireEvent.click(screen.getByRole('button', { name: 'Open demo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Manage in Willy' }))
    await screen.findByText('Verification required')
    expect(importExisting).toHaveBeenCalledWith({
      target: { name: 'demo', id: 'id' },
      mountPath: record.mountPath
    })
    expect(provision).not.toHaveBeenCalled()
    expect(screen.getAllByText('demo')).toHaveLength(1)
    expect(
      within(screen.getByRole('region', { name: 'Managed by Willy' })).getByText('demo')
    ).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'External' })).toBeNull()
    expect(
      (await screen.findByRole('button', { name: 'Verify environment' })).hasAttribute('disabled')
    ).toBe(false)
    expect(screen.queryByRole('button', { name: 'Link project' })).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Start sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
  })
  it('loads background progress again when settings reopen and prevents competing operations', async () => {
    listManaged.mockResolvedValue([record])
    const first = render(<SandboxCatalog available sandboxes={[]} />)
    expect(await screen.findByText('demo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New sandbox' }).hasAttribute('disabled')).toBe(true)
    first.unmount()
    listManaged.mockResolvedValue([{ ...record, status: 'error', error: 'SSH unavailable' }])
    render(<SandboxCatalog available sandboxes={[]} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Open demo' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'SSH unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Resume / configure' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'resume', tools: ['uv'] })
      )
    )
  })
  it('keeps failed submissions visible and disables provisioning when sbx is unavailable', async () => {
    const view = render(<SandboxCatalog available={false} sandboxes={[]} />)
    await waitFor(() => expect(listManaged).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'New sandbox' }).hasAttribute('disabled')).toBe(true)
    view.rerender(<SandboxCatalog available sandboxes={[]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'New sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    provision.mockRejectedValue(new Error('Folder does not exist'))
    fireEvent.click(screen.getByRole('button', { name: 'New sandbox' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('Shared folder on this computer'), {
      target: { value: '/missing' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Folder does not exist')
  })
})

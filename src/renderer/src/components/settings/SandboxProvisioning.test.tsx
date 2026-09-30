// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { SandboxProvisioning } from './SandboxProvisioning'

const listManaged = vi.fn<() => Promise<ManagedSandbox[]>>()
const provision = vi.fn()
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
  listManaged.mockReset().mockResolvedValue([])
  provision.mockReset().mockResolvedValue(record)
  vi.stubGlobal('api', {
    sandboxes: { listManaged, provision },
    repos: { pickFolder: vi.fn().mockResolvedValue('/work/chosen') }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('sandbox provisioning UI', () => {
  it('defaults to all optional tools and sends the explicit folder creation choice', async () => {
    render(<SandboxProvisioning available sandboxes={[]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Create sandbox' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('Shared folder on this computer'), {
      target: { value: '/work/with spaces' }
    })
    fireEvent.click(screen.getByLabelText('Create this folder if it does not exist'))
    fireEvent.click(screen.getByLabelText('Claude Code'))
    fireEvent.click(screen.getByLabelText('Databricks CLI'))
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
  })
  it('adopts with the observed ID and immutable name / mount', async () => {
    render(
      <SandboxProvisioning
        available
        sandboxes={[
          {
            id: 'id',
            name: 'demo',
            agent: 'shell',
            status: 'stopped',
            workspaces: ['/work/with spaces']
          }
        ]}
      />
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Adopt demo' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Adopt demo' }))
    expect(screen.getByLabelText('Name').hasAttribute('readonly')).toBe(true)
    expect(screen.getByLabelText('Shared folder on this computer').hasAttribute('readonly')).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
    await waitFor(() =>
      expect(provision).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'adopt', sandboxId: 'id' })
      )
    )
  })
  it('loads background progress again when settings reopen and prevents competing operations', async () => {
    listManaged.mockResolvedValue([record])
    const first = render(<SandboxProvisioning available sandboxes={[]} />)
    expect(await screen.findByText('demo.sbx')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create sandbox' }).hasAttribute('disabled')).toBe(
      true
    )
    first.unmount()
    listManaged.mockResolvedValue([{ ...record, status: 'error', error: 'SSH unavailable' }])
    render(<SandboxProvisioning available sandboxes={[]} />)
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
    const view = render(<SandboxProvisioning available={false} sandboxes={[]} />)
    await waitFor(() => expect(listManaged).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Create sandbox' }).hasAttribute('disabled')).toBe(
      true
    )
    view.rerender(<SandboxProvisioning available sandboxes={[]} />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create sandbox' }).hasAttribute('disabled')).toBe(
        false
      )
    )
    provision.mockRejectedValue(new Error('Folder does not exist'))
    fireEvent.click(screen.getByRole('button', { name: 'Create sandbox' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'demo' } })
    fireEvent.change(screen.getByLabelText('Shared folder on this computer'), {
      target: { value: '/missing' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Folder does not exist')
  })
})

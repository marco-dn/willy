// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SandboxImportPanel } from './SandboxImportPanel'
const importExisting = vi.fn()
const sandbox = {
  name: 'external',
  id: 'id',
  agent: 'shell',
  status: 'stopped',
  workspaces: ['/first folder', '/second folder']
}
beforeEach(() => {
  importExisting.mockReset()
  vi.stubGlobal('api', { sandboxes: { importExisting } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('requires explicit selection when several mounts are available', async () => {
  const onImported = vi.fn()
  render(<SandboxImportPanel sandbox={sandbox} disabled={false} onImported={onImported} />)
  const button = screen.getByRole('button', { name: 'Manage in Willy' })
  expect(button.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('combobox', { name: 'Shared folder to manage' }))
  fireEvent.click(await screen.findByRole('option', { name: '/second folder' }))
  fireEvent.click(button)
  await waitFor(() =>
    expect(importExisting).toHaveBeenCalledWith({
      target: { name: 'external', id: 'id' },
      mountPath: '/second folder'
    })
  )
  expect(onImported).toHaveBeenCalledOnce()
})
it('keeps errors visible and does not claim a failed import succeeded', async () => {
  importExisting.mockRejectedValue(new Error('Sandbox identity changed'))
  const onImported = vi.fn()
  render(
    <SandboxImportPanel
      sandbox={{ ...sandbox, workspaces: ['/first folder'] }}
      disabled={false}
      onImported={onImported}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Manage in Willy' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Sandbox identity changed')
  expect(onImported).not.toHaveBeenCalled()
})
it.each([{ agent: 'claude' }, { workspaces: [] }])(
  'does not offer import for unsupported sandboxes: %j',
  (change) => {
    render(
      <SandboxImportPanel
        sandbox={{ ...sandbox, ...change }}
        disabled={false}
        onImported={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Manage in Willy' })).toBeNull()
    expect(
      screen.getByText('Willy can manage only shell sandboxes with a shared folder.')
    ).toBeTruthy()
  }
)

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  SANDBOX_TOOLS,
  type SandboxProvisionRequest
} from '../../../../shared/sandbox-provisioning-types'
import { SandboxProvisionForm } from './SandboxProvisionForm'
const provision = vi.fn()
const initial: SandboxProvisionRequest = {
  mode: 'resume',
  sandboxId: 'id',
  name: 'demo',
  mountPath: '/shared folder',
  tools: [],
  createMount: false
}
beforeEach(() => {
  provision.mockReset().mockResolvedValue({})
  vi.stubGlobal('api', { sandboxes: { provision } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('leaves imported tools unchecked and requires explicit submit', async () => {
  render(<SandboxProvisionForm initial={initial} onClose={vi.fn()} onSubmitted={vi.fn()} />)
  expect(
    screen
      .getAllByRole('checkbox')
      .every((checkbox) => checkbox.getAttribute('aria-checked') === 'false')
  ).toBe(true)
  expect(provision).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'uv' }))
  fireEvent.click(screen.getByRole('button', { name: 'Start provisioning' }))
  await waitFor(() => expect(provision).toHaveBeenCalledWith({ ...initial, tools: ['uv'] }))
})
it('can leave the preparation form without changes', () => {
  const onClose = vi.fn()
  render(<SandboxProvisionForm initial={initial} onClose={onClose} onSubmitted={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Back to sandboxes' }))
  expect(onClose).toHaveBeenCalledOnce()
  expect(provision).not.toHaveBeenCalled()
})
it('preserves the default optional tools for a new sandbox', () => {
  render(
    <SandboxProvisionForm
      initial={{ ...initial, mode: 'create', tools: [...SANDBOX_TOOLS] }}
      onClose={vi.fn()}
      onSubmitted={vi.fn()}
    />
  )
  for (const name of ['uv', 'Claude Code', 'Codex CLI', 'Databricks CLI', 'Orca skills']) {
    expect(screen.getByRole('checkbox', { name }).getAttribute('aria-checked')).toBe('true')
  }
})

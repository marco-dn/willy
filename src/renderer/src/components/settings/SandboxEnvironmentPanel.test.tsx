// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { SandboxEnvironmentPanel } from './SandboxEnvironmentPanel'
const verifyEnvironment = vi.fn()
const connect = vi.fn()
const record: ManagedSandbox = {
  name: 'demo',
  sandboxId: 'uuid',
  mountPath: '/shared folder',
  tools: [],
  operationId: 'op',
  status: 'imported',
  stage: 'verify',
  updatedAt: 1,
  logs: [],
  versions: []
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('api', { sandboxes: { verifyEnvironment }, ssh: { connect } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it('offers explicit preparation after missing prerequisites without starting it', async () => {
  const onPrepare = vi.fn()
  verifyEnvironment.mockResolvedValue({
    checkedAt: 2,
    outcome: 'needs-preparation',
    canPrepare: true,
    checks: [{ id: 'just', status: 'missing', detail: 'Command not found' }]
  })
  render(<SandboxEnvironmentPanel record={record} disabled={false} onPrepare={onPrepare} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify environment' }))
  const prepare = await screen.findByRole('button', { name: 'Prepare environment' })
  expect(verifyEnvironment).toHaveBeenCalledWith({ name: 'demo', id: 'uuid' })
  expect(onPrepare).not.toHaveBeenCalled()
  expect(connect).not.toHaveBeenCalled()
  fireEvent.click(prepare)
  expect(onPrepare).toHaveBeenCalledOnce()
})
it('shows stopped or unreachable errors without offering installation', async () => {
  verifyEnvironment.mockResolvedValue({
    checkedAt: 2,
    outcome: 'unavailable',
    canPrepare: false,
    checks: [{ id: 'sandbox', status: 'error', detail: 'Start the sandbox first.' }]
  })
  render(<SandboxEnvironmentPanel record={record} disabled={false} onPrepare={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify environment' }))
  expect(await screen.findByText('Start the sandbox first.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Prepare environment' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Connect SSH' })).toBeNull()
})
it('connects SSH only after the explicit connection action', async () => {
  connect.mockResolvedValue({ status: 'connected' })
  render(
    <SandboxEnvironmentPanel
      record={{
        ...record,
        status: 'ready',
        sshTargetId: 'ssh-id',
        verification: { checkedAt: 2, outcome: 'ready', canPrepare: false, checks: [] }
      }}
      disabled={false}
      onPrepare={vi.fn()}
    />
  )
  expect(connect).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Connect SSH' }))
  await waitFor(() => expect(connect).toHaveBeenCalledWith({ targetId: 'ssh-id' }))
  expect(await screen.findByText('SSH connection completed.')).toBeTruthy()
})
it('keeps IPC failures visible and allows retry', async () => {
  verifyEnvironment.mockRejectedValue(new Error('Another operation is running'))
  render(<SandboxEnvironmentPanel record={record} disabled={false} onPrepare={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Verify environment' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Another operation is running')
  expect(screen.getByRole('button', { name: 'Verify environment' }).hasAttribute('disabled')).toBe(
    false
  )
})

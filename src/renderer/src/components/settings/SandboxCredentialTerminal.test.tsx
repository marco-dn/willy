// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SandboxCredentialEvent } from '../../../../shared/sandbox-policy-types'
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  open: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
  onData: vi.fn(() => ({ dispose: vi.fn() }))
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: { disableStdin?: boolean } = {}
    cols = 80
    rows = 20
    constructor(options: object) {
      mocks.options(options)
    }
    loadAddon() {}
    open = mocks.open
    write = mocks.write
    dispose = mocks.dispose
    onData = mocks.onData
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
import { SandboxCredentialTerminal } from './SandboxCredentialTerminal'
const sessionId = '11111111-1111-4111-8111-111111111111'
const start = vi.fn()
const close = vi.fn()
let receive: ((event: SandboxCredentialEvent) => void) | undefined
beforeEach(() => {
  vi.clearAllMocks()
  start.mockResolvedValue(undefined)
  close.mockResolvedValue(undefined)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('api', {
    sandboxes: {
      startCredentials: start,
      closeCredentials: close,
      writeCredentials: vi.fn().mockResolvedValue(undefined),
      resizeCredentials: vi.fn().mockResolvedValue(undefined),
      onCredentialEvent: (listener: (event: SandboxCredentialEvent) => void) => {
        receive = listener
        return vi.fn()
      }
    }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('private credential terminal lifecycle', () => {
  it('disables scrollback and logging, then disposes the terminal on cancellation', async () => {
    render(
      <SandboxCredentialTerminal
        target={{ name: 'demo', id: 'id' }}
        sessionId={sessionId}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(mocks.options).toHaveBeenCalledWith(
      expect.objectContaining({ scrollback: 0, logLevel: 'off' })
    )
    act(() => receive?.({ sessionId, type: 'data', data: 'Token:' }))
    expect(mocks.write).toHaveBeenCalledWith('Token:')
    act(() => receive?.({ sessionId, type: 'exit', result: 'cancelled' }))
    expect(mocks.dispose).toHaveBeenCalledOnce()
    expect(screen.getByRole('status').textContent).toContain(
      'Credential status has not been verified'
    )
    act(() => receive?.({ sessionId, type: 'data', data: 'late output' }))
    expect(mocks.write).toHaveBeenCalledTimes(1)
  })
  it('closes the owning backend prompt when settings unmount', async () => {
    const view = render(
      <SandboxCredentialTerminal
        target={{ name: 'demo', id: 'id' }}
        sessionId={sessionId}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    view.unmount()
    expect(close).toHaveBeenCalledWith(sessionId)
    expect(mocks.dispose).toHaveBeenCalledOnce()
  })
  it('does not imply Git authentication after sbx exits successfully', async () => {
    render(
      <SandboxCredentialTerminal
        target={{ name: 'demo', id: 'id' }}
        sessionId={sessionId}
        onClose={vi.fn()}
      />
    )
    await waitFor(() => expect(start).toHaveBeenCalledOnce())
    act(() => receive?.({ sessionId, type: 'exit', result: 'completed' }))
    expect(screen.getByRole('status').textContent).toContain(
      'Git authentication has not been verified'
    )
  })
})

// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SandboxAccessPanel } from './SandboxAccessPanel'
vi.mock('./SandboxCredentialTerminal', () => ({
  SandboxCredentialTerminal: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Cancel private prompt</button>
  )
}))
const target = { name: 'demo', id: 'sandbox-id' }
const policy = vi.fn()
const ownRule = {
  id: 'own',
  scope: 'sandbox:demo',
  layer: 'local',
  decision: 'allow',
  resources: ['example.org'],
  actions: ['net:connect:tcp'],
  editable: true
}
beforeEach(() => {
  policy.mockReset().mockResolvedValue({
    rules: [ownRule, { ...ownRule, id: 'inherited', scope: 'global', editable: false }]
  })
  vi.stubGlobal('api', { sandboxes: { policy } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('sandbox access controls', () => {
  it('renders inherited rules without removal controls and scopes additions to the selected sandbox', async () => {
    render(<SandboxAccessPanel target={target} disabled={false} />)
    await screen.findByText('Sandbox TCP allow rules')
    expect(screen.getAllByRole('button', { name: 'Remove rule' })).toHaveLength(1)
    const inherited = screen.getByText('Inherited and other read-only policies').closest('section')
    expect(inherited && within(inherited).queryByRole('button')).toBeNull()
    fireEvent.change(screen.getByLabelText('TCP destination'), {
      target: { value: 'new.example:443' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow destination' }))
    await waitFor(() =>
      expect(policy).toHaveBeenCalledWith({
        target,
        action: 'add',
        destination: 'new.example:443',
        ruleId: undefined
      })
    )
  })
  it('shows the policy denial and organization explanation', async () => {
    render(<SandboxAccessPanel target={target} disabled={false} />)
    await screen.findByText('Sandbox TCP allow rules')
    policy.mockResolvedValue({
      target: 'blocked.example',
      allowed: false,
      reason: 'Blocked by organization rule',
      denyKind: 'governance',
      governanceActive: true
    })
    fireEvent.change(screen.getByLabelText('TCP destination'), {
      target: { value: 'blocked.example' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check access' }))
    expect(await screen.findByText('Policy denies blocked.example.')).toBeTruthy()
    expect(screen.getByText('Blocked by organization rule')).toBeTruthy()
    expect(
      screen.getByText(
        'Organization policies apply. A sandbox rule cannot override an organization denial.'
      )
    ).toBeTruthy()
  })
  it('does not mark credentials configured when the optional prompt is closed', async () => {
    render(<SandboxAccessPanel target={target} disabled={false} />)
    await screen.findByText('Sandbox TCP allow rules')
    fireEvent.click(screen.getByRole('button', { name: 'Open GitHub credential prompt' }))
    expect(screen.getByRole('button', { name: 'Check access' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel private prompt' }))
    expect(screen.getByRole('button', { name: 'Open GitHub credential prompt' })).toBeTruthy()
    expect(screen.queryByText(/credentials configured/i)).toBeNull()
    expect(policy).toHaveBeenCalledTimes(1)
  })
  it('reports detection failures without presenting an empty policy list', async () => {
    policy.mockRejectedValue(new Error('Daemon unavailable'))
    render(<SandboxAccessPanel target={target} disabled={false} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Daemon unavailable')
    expect(screen.queryByText('No rules in this group.')).toBeNull()
  })
})

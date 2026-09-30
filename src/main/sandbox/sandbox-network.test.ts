import { describe, expect, it, vi } from 'vitest'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import { cleanupProvisioningNetwork, openProvisioningNetwork } from './sandbox-network'

const ownId = '11111111-1111-4111-8111-111111111111'
function record(): ManagedSandbox {
  return {
    name: 'demo',
    mountPath: '/tmp/demo',
    tools: [],
    operationId: 'op',
    status: 'provisioning',
    stage: 'network',
    updatedAt: 0,
    logs: [],
    versions: []
  }
}
function rule(id: string, scope = 'sandbox:demo') {
  return {
    id,
    scope,
    resource_type: 'network',
    decision: 'allow',
    resources: ['**'],
    actions: ['net:connect:tcp'],
    editable: true,
    layer: 'local'
  }
}
function fixture(initial = [rule('global', 'global'), rule('other', 'sandbox:other')]) {
  let rules = initial
  const run = vi.fn(async (args: string[]) => {
    if (args[1] === 'ls') {
      return JSON.stringify({ rules })
    }
    if (args[1] === 'allow') {
      rules.push(rule(ownId), rule('concurrent-user-rule'))
      return `Rule added to policy local (scope: sandbox:demo): ${ownId} (** [tcp])`
    }
    if (args[1] === 'rm') {
      rules = rules.filter((rule) => rule.id !== args[6])
      return ''
    }
    return '{"allowed":true}'
  })
  return { run, rules: () => rules }
}
describe('temporary provisioning TCP rules', () => {
  it('journals before creation and removes only the ID returned by sbx', async () => {
    const state = record()
    const f = fixture()
    const saved: ManagedSandbox[] = []
    const save = () => saved.push(structuredClone(state))
    await openProvisioningNetwork(f.run, state, save)
    expect(saved[0].network).toEqual({ beforeIds: [], createdIds: [], pending: true })
    expect(state.network?.createdIds).toEqual([ownId])
    await cleanupProvisioningNetwork(f.run, state, save)
    expect(f.rules().map((rule) => rule.id)).toEqual(['global', 'other', 'concurrent-user-rule'])
    expect(state.network).toBeUndefined()
  })
  it('preserves an existing open rule', async () => {
    const f = fixture([rule('pre-existing')])
    const state = record()
    await openProvisioningNetwork(f.run, state, vi.fn())
    await cleanupProvisioningNetwork(f.run, state, vi.fn())
    expect(f.run.mock.calls.some(([args]) => ['allow', 'rm'].includes(args[1]))).toBe(false)
  })
  it('recovers recorded IDs after restart and tolerates an already removed rule', async () => {
    const f = fixture([rule(ownId)])
    const state = record()
    state.network = { beforeIds: [], createdIds: [ownId, 'already-gone'], pending: false }
    await cleanupProvisioningNetwork(f.run, state, vi.fn())
    expect(f.rules()).toEqual([])
  })
  it('does not guess ownership after an interruption before the ID was saved', async () => {
    const f = fixture([rule('unknown')])
    const state = record()
    state.network = { beforeIds: [], createdIds: [], pending: true }
    await expect(cleanupProvisioningNetwork(f.run, state, vi.fn())).rejects.toThrow(
      'Review these rules'
    )
    expect(f.run).toHaveBeenCalledTimes(1)
    expect(state.network?.pending).toBe(true)
  })
  it('reports an organization deny and still supports cleanup', async () => {
    const f = fixture()
    const state = record()
    const run = async (args: string[]) => (args[1] === 'check' ? '{"allowed":false}' : f.run(args))
    await expect(openProvisioningNetwork(run, state, vi.fn())).rejects.toThrow(
      'Network policy denies'
    )
    await cleanupProvisioningNetwork(run, state, vi.fn())
    expect(f.rules().some((rule) => rule.id === ownId)).toBe(false)
  })
})

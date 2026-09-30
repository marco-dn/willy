import { describe, expect, it, vi } from 'vitest'
import { normalizeSandboxDestination } from '../../shared/sandbox-policy-types'
import { SandboxPolicyService } from './sandbox-policy-service'

function rule(id: string, scope = 'sandbox:demo', extra: object = {}) {
  return {
    id,
    scope,
    resource_type: 'network',
    decision: 'allow',
    resources: ['example.org:443'],
    actions: ['net:connect:tcp'],
    layer: 'local',
    editable: true,
    ...extra
  }
}
function fixture() {
  let rules = [
    rule('own'),
    rule('global', 'global'),
    rule('other', 'sandbox:other'),
    rule('org', 'sandbox:demo', { layer: 'organization', editable: false, decision: 'deny' }),
    rule('udp', 'sandbox:demo', { actions: ['net:connect:tcp', 'net:connect:udp'] })
  ]
  const run = vi.fn(async (args: string[]) => {
    if (args[1] === 'ls') {
      return JSON.stringify({ rules })
    }
    if (args[1] === 'allow') {
      rules.push(rule('new', `sandbox:${args[4]}`, { resources: [args[7]] }))
      return ''
    }
    if (args[1] === 'rm') {
      rules = rules.filter((rule) => rule.id !== args[6])
      return ''
    }
    if (args[1] === 'check') {
      return JSON.stringify({
        allowed: false,
        deny_kind: 'governance',
        reason: 'Organization policy denies access',
        governance: { active: true }
      })
    }
    throw new Error('Unexpected command')
  })
  const release = vi.fn()
  const acquire = vi.fn(async () => ({ run, release }))
  return { service: new SandboxPolicyService(acquire), run, acquire, release, rules: () => rules }
}
const target = { name: 'demo', id: 'sandbox-id' }
describe('sandbox policy service', () => {
  it('separates editable TCP rules from inherited, organization and mixed-protocol rules', async () => {
    const f = fixture()
    const result = await f.service.execute({ target, action: 'list' })
    expect(
      'rules' in result && result.rules.filter((rule) => rule.editable).map((rule) => rule.id)
    ).toEqual(['own'])
    expect(f.release).toHaveBeenCalledOnce()
  })
  it('adds a scoped rule and reports an organizational denial instead of claiming access', async () => {
    const f = fixture()
    const result = await f.service.execute({
      target,
      action: 'add',
      destination: 'New.Example:443'
    })
    expect(f.run).toHaveBeenCalledWith([
      'policy',
      'allow',
      'network',
      '--sandbox',
      'demo',
      '--protocol',
      'tcp',
      'new.example:443'
    ])
    expect('rules' in result && result.check).toEqual(
      expect.objectContaining({ allowed: false, governanceActive: true, denyKind: 'governance' })
    )
    expect(f.rules().filter((rule) => rule.id === 'other')).toEqual([
      rule('other', 'sandbox:other')
    ])
  })
  it.each(['global', 'other', 'org', 'udp', 'missing'])(
    'refuses removal of rule %s',
    async (ruleId) => {
      const f = fixture()
      await expect(f.service.execute({ target, action: 'remove', ruleId })).rejects.toThrow(
        'inherited, read-only or has changed'
      )
      expect(f.run.mock.calls.some(([args]) => args[1] === 'rm')).toBe(false)
      expect(f.release).toHaveBeenCalledOnce()
    }
  )
  it('removes only the selected local rule ID', async () => {
    const f = fixture()
    await f.service.execute({ target, action: 'remove', ruleId: 'own' })
    expect(f.rules().map((rule) => rule.id)).toEqual(['global', 'other', 'org', 'udp'])
    expect(f.run).toHaveBeenCalledWith([
      'policy',
      'rm',
      'network',
      '--sandbox',
      'demo',
      '--id',
      'own',
      '--force'
    ])
  })
  it('does not duplicate existing local allow rules', async () => {
    const f = fixture()
    await f.service.execute({ target, action: 'add', destination: 'example.org:443' })
    expect(f.run.mock.calls.some(([args]) => args[1] === 'allow')).toBe(false)
  })
  it('does not infer coverage for a wildcard from one sampled domain', async () => {
    const f = fixture()
    await f.service.execute({ target, action: 'add', destination: '*.example.net' })
    expect(f.run.mock.calls.some(([args]) => args[1] === 'check')).toBe(false)
    await expect(
      f.service.execute({ target, action: 'check', destination: '*.example.net' })
    ).rejects.toThrow('concrete host')
  })
  it.each([
    '**',
    '*',
    'https://example.org',
    'host:0',
    'host:65536',
    'a,b',
    'a;echo bad',
    '-bad.org',
    'a..org',
    'a/b',
    'a b',
    'foo?.org',
    'a\n.org'
  ])('rejects invalid destination %s before acquiring the sandbox', async (destination) => {
    const f = fixture()
    await expect(f.service.execute({ target, action: 'add', destination })).rejects.toThrow()
    expect(f.acquire).not.toHaveBeenCalled()
  })
  it('normalizes supported domain wildcards and ports', () => {
    expect(normalizeSandboxDestination(' **.Example.NET:00443 ')).toBe('**.example.net:443')
    expect(normalizeSandboxDestination('localhost')).toBe('localhost')
  })
})

import { describe, expect, it } from 'vitest'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { sandboxCatalogEntries } from './sandbox-catalog'
const record: ManagedSandbox = {
  name: 'demo',
  sandboxId: 'id',
  mountPath: '/shared folder',
  tools: [],
  operationId: 'op',
  status: 'ready',
  stage: 'cleanup',
  updatedAt: 1,
  logs: [],
  versions: []
}
const observed = {
  name: 'demo',
  id: 'id',
  agent: 'shell',
  status: 'stopped',
  workspaces: ['/shared folder']
}
describe('sandbox catalog identity', () => {
  it('shows a managed and observed UUID once', () => {
    expect(sandboxCatalogEntries([observed], [record], true)).toEqual([
      expect.objectContaining({ record, observed, state: 'stopped' })
    ])
  })
  it('keeps a replacement with the same name separate from the missing registration', () => {
    const rows = sandboxCatalogEntries([{ ...observed, id: 'replacement' }], [record], true)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.record)?.state).toBe('missing')
    expect(rows.find((row) => !row.record)?.observed?.id).toBe('replacement')
  })
  it('does not infer removal when the service is unavailable', () => {
    expect(sandboxCatalogEntries([], [record], false)[0].state).toBe('unavailable')
  })
  it('retains incomplete creation without assuming the identity of a same-name sandbox', () => {
    const pending = { ...record, sandboxId: undefined, status: 'interrupted' as const }
    const rows = sandboxCatalogEntries([observed], [pending], true)
    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.record)?.state).toBe('uncreated')
  })
})

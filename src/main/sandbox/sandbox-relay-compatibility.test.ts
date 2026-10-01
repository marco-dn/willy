import { beforeEach, expect, it, vi } from 'vitest'
import type { SandboxEnvironmentCheck } from '../../shared/sandbox-environment-types'
const mocks = vi.hoisted(() => ({ exists: vi.fn(), version: vi.fn() }))
vi.mock('electron', () => ({ app: { getAppPath: () => '/app' } }))
vi.mock('node:fs', () => ({ existsSync: mocks.exists }))
vi.mock('../ssh/relay-bundle-paths', () => ({ relayBundleCandidates: () => ['/relay'] }))
vi.mock('../ssh/ssh-relay-versioned-install', () => ({ readLocalFullVersion: mocks.version }))
import { checkSandboxRelayCompatibility } from './sandbox-relay-compatibility'
function checks(overrides: Record<string, string> = {}): SandboxEnvironmentCheck[] {
  return Object.entries({
    platform: 'Linux x86_64',
    libc: 'glibc 2.31',
    node: 'v22.22.1',
    npm: '9.2.0',
    ...overrides
  }).map(([id, detail]) => ({ id, status: 'ok', detail }))
}
beforeEach(() => {
  mocks.exists.mockReturnValue(true)
  mocks.version.mockReturnValue('0.1.0+hash')
})
it('accepts supported guests and describes the deferred runtime check', () => {
  expect(checkSandboxRelayCompatibility(checks())).toMatchObject({
    status: 'ok',
    detail: expect.stringContaining('Runtime startup')
  })
  expect(checkSandboxRelayCompatibility(checks({ platform: 'Linux aarch64' })).status).toBe('ok')
})
it.each<Record<string, string>>([
  { platform: 'Darwin arm64' },
  { libc: 'glibc 2.30' },
  { libc: 'musl' }
])('rejects incompatible guest platforms: %j', (change) => {
  expect(checkSandboxRelayCompatibility(checks(change)).status).toBe('error')
})
it('distinguishes missing local packaging from repairable guest tools', () => {
  mocks.exists.mockReturnValue(false)
  expect(checkSandboxRelayCompatibility(checks())).toMatchObject({
    status: 'error',
    detail: expect.stringContaining('Build or reinstall Willy')
  })
  mocks.exists.mockReturnValue(true)
  expect(checkSandboxRelayCompatibility(checks({ node: 'v16.0.0' })).status).toBe('missing')
  expect(checkSandboxRelayCompatibility(checks({ npm: 'Command not found' })).status).toBe(
    'missing'
  )
})
it('rejects unreadable local relay metadata', () => {
  mocks.version.mockImplementation(() => {
    throw new Error('Invalid version')
  })
  expect(checkSandboxRelayCompatibility(checks())).toMatchObject({
    status: 'error',
    detail: 'Invalid version'
  })
})

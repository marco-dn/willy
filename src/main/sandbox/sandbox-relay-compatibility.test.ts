import { beforeEach, expect, it, vi } from 'vitest'
import type { SandboxEnvironmentCheck } from '../../shared/sandbox-environment-types'
const template = vi.hoisted(() => vi.fn())
vi.mock('../orcad/orcad-artifact-materializer', () => ({ hasOrcadTemplate: template }))
import { checkSandboxRelayCompatibility } from './sandbox-relay-compatibility'
function checks(platform = 'Linux x86_64'): SandboxEnvironmentCheck[] {
  return [{ id: 'platform', status: 'ok', detail: platform }]
}
beforeEach(() => template.mockReturnValue(true))
it.each(['Linux x86_64', 'Linux aarch64'])(
  'uses the managed server template with its pinned Node runtime on %s',
  (platform) => {
    expect(checkSandboxRelayCompatibility(checks(platform))).toMatchObject({
      status: 'ok',
      detail: expect.stringContaining('Runtime startup')
    })
  }
)
it.each(['Darwin arm64', 'Linux armv7l'])(
  'rejects unsupported sandbox platforms: %s',
  (platform) => {
    expect(checkSandboxRelayCompatibility(checks(platform)).status).toBe('error')
  }
)
it('distinguishes missing client packaging from guest preparation', () => {
  template.mockReturnValue(false)
  expect(checkSandboxRelayCompatibility(checks())).toMatchObject({
    status: 'error',
    detail: expect.stringContaining('Build or reinstall Willy')
  })
})

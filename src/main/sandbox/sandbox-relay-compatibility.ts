import type { SandboxEnvironmentCheck } from '../../shared/sandbox-environment-types'
import { hasOrcadTemplate } from '../orcad/orcad-artifact-materializer'

export function checkSandboxRelayCompatibility(
  checks: SandboxEnvironmentCheck[]
): SandboxEnvironmentCheck {
  const value = (id: string) => checks.find((check) => check.id === id)?.detail ?? ''
  const [os, arch] = value('platform').split(' ')
  if (os !== 'Linux' || !['x86_64', 'aarch64'].includes(arch)) {
    return {
      id: 'relay',
      status: 'error',
      detail: 'The sandbox server requires Linux x64 or arm64.'
    }
  }
  if (!hasOrcadTemplate()) {
    return {
      id: 'relay',
      status: 'error',
      detail:
        'The local managed server template is missing. Build or reinstall Willy; preparing the guest cannot repair this.'
    }
  }
  return {
    id: 'relay',
    status: 'ok',
    detail:
      'Managed server template available. Runtime startup and platform compatibility are checked when connecting SSH.'
  }
}

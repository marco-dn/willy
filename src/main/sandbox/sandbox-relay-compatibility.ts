import { existsSync } from 'node:fs'
import { app } from 'electron'
import type { SandboxEnvironmentCheck } from '../../shared/sandbox-environment-types'
import { relayBundleCandidates } from '../ssh/relay-bundle-paths'
import { parseUnameToRelayPlatform } from '../ssh/relay-protocol'
import { nodeToolchainVersionsMeetRequirements } from '../ssh/ssh-remote-node-toolchain-probe'
import { readLocalFullVersion } from '../ssh/ssh-relay-versioned-install'

export function checkSandboxRelayCompatibility(
  checks: SandboxEnvironmentCheck[]
): SandboxEnvironmentCheck {
  const value = (id: string) => checks.find((check) => check.id === id)?.detail ?? ''
  const [os, arch] = value('platform').split(' ')
  const platform = parseUnameToRelayPlatform(os ?? '', arch ?? '')
  if (platform !== 'linux-x64' && platform !== 'linux-arm64') {
    return {
      id: 'relay',
      status: 'error',
      detail: 'The sandbox relay requires Linux x64 or arm64.'
    }
  }
  const libc = /^glibc (\d+)\.(\d+)/.exec(value('libc'))
  if (!libc || Number(libc[1]) < 2 || (Number(libc[1]) === 2 && Number(libc[2]) < 31)) {
    return {
      id: 'relay',
      status: 'error',
      detail: 'The sandbox relay requires glibc 2.31 or newer.'
    }
  }
  const local = relayBundleCandidates(platform, app.getAppPath()).find(existsSync)
  if (!local) {
    return {
      id: 'relay',
      status: 'error',
      detail: `The local relay bundle for ${platform} is missing. Build or reinstall Willy; preparing the guest cannot repair this.`
    }
  }
  let version: string
  try {
    version = readLocalFullVersion(local)
  } catch (error) {
    return {
      id: 'relay',
      status: 'error',
      detail: error instanceof Error ? error.message : 'Could not read the local relay version.'
    }
  }
  if (
    !nodeToolchainVersionsMeetRequirements(
      `__ORCA_NODE_VERSION__\n${value('node')}\n__ORCA_NPM_VERSION__\n${value('npm')}`
    )
  ) {
    return {
      id: 'relay',
      status: 'missing',
      detail: 'Node.js 18 or newer and npm are required for the relay.'
    }
  }
  return {
    id: 'relay',
    status: 'ok',
    detail: `${platform}; relay ${version}. Runtime startup is checked when connecting SSH.`
  }
}

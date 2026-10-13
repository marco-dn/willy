export type SandboxTarget = { name: string; id: string }
export type SandboxNetworkRule = {
  id: string
  scope: string
  layer: string
  decision: string
  resources: string[]
  actions: string[]
  editable: boolean
}
export type SandboxNetworkCheck = {
  target: string
  allowed: boolean
  reason: string | null
  denyKind: string | null
  governanceActive: boolean
}
export type SandboxPolicySnapshot = { rules: SandboxNetworkRule[]; check?: SandboxNetworkCheck }
export type SandboxCredentialEvent = {
  sessionId: string
} & (
  | { type: 'data'; data: string }
  | { type: 'exit'; result: 'completed' | 'cancelled' | 'failed' }
)

export function normalizeSandboxDestination(input: string, allowWildcard = true): string {
  const value = input.trim().toLowerCase()
  const match = /^(\*\*\.|\*\.)?([^:]+)(?::([0-9]{1,5}))?$/.exec(value)
  if (!match || (!allowWildcard && match[1])) {
    throw new Error(
      'Enter a domain with an optional TCP port; use a concrete host when checking access.'
    )
  }
  const host = match[2]
  if (
    host.length > 253 ||
    !host.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new Error('Enter a valid domain, optionally prefixed with *. or **.')
  }
  const port = match[3] === undefined ? undefined : Number(match[3])
  if (port !== undefined && (port < 1 || port > 65535)) {
    throw new Error('TCP ports must be between 1 and 65535.')
  }
  return `${match[1] ?? ''}${host}${port === undefined ? '' : `:${port}`}`
}

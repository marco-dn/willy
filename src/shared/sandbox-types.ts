import type {
  SandboxTarget,
  SandboxPolicySnapshot,
  SandboxNetworkCheck,
  SandboxCredentialEvent
} from './sandbox-policy-types'
import type { ManagedSandbox, SandboxProvisionRequest } from './sandbox-provisioning-types'
export type SandboxSummary = {
  id: string
  name: string
  agent: string
  status: string
  workspaces: string[]
}

export type SandboxInspectionError =
  | 'cli-missing'
  | 'command-failed'
  | 'timeout'
  | 'invalid-response'
  | 'service-unavailable'

export type SandboxInspection = {
  cliPath: string | null
  clientVersion: string | null
  serverVersion: string | null
  serverState: string | null
} & (
  | { status: 'ready'; sandboxes: SandboxSummary[] }
  | { status: 'error'; reason: SandboxInspectionError; detail: string }
)

export type SandboxesApi = {
  policy: (request: {
    target: SandboxTarget
    action: 'list' | 'add' | 'remove' | 'check'
    destination?: string
    ruleId?: string
  }) => Promise<SandboxPolicySnapshot | SandboxNetworkCheck>
  startCredentials: (request: {
    target: SandboxTarget
    sessionId: string
    cols: number
    rows: number
  }) => Promise<void>
  writeCredentials: (request: { sessionId: string; data: string }) => Promise<void>
  resizeCredentials: (request: { sessionId: string; cols: number; rows: number }) => Promise<void>
  closeCredentials: (sessionId: string) => Promise<void>
  onCredentialEvent: (listener: (event: SandboxCredentialEvent) => void) => () => void
  inspect: () => Promise<SandboxInspection>
  listManaged: () => Promise<ManagedSandbox[]>
  provision: (request: SandboxProvisionRequest) => Promise<ManagedSandbox>
}

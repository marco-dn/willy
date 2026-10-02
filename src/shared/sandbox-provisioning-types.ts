import type { SandboxEnvironmentReport } from './sandbox-environment-types'
import type { SandboxTarget } from './sandbox-policy-types'
import type { SandboxLifecycleState } from './sandbox-lifecycle-types'
export const SANDBOX_TOOLS = ['uv', 'claude', 'codex', 'databricks', 'orca-skills'] as const
export type SandboxTool = (typeof SANDBOX_TOOLS)[number]
export type SandboxProvisionRequest = {
  mode: 'create' | 'adopt' | 'resume'
  name: string
  mountPath: string
  createMount: boolean
  tools: SandboxTool[]
  sandboxId?: string
  gitName?: string
  gitEmail?: string
}
export type SandboxImportRequest = { target: SandboxTarget; mountPath: string }
export type SandboxProvisionStage =
  | 'sandbox'
  | 'ssh'
  | 'network'
  | 'base'
  | SandboxTool
  | 'verify'
  | 'connect'
  | 'cleanup'
export type ManagedSandbox = {
  gitName?: string
  gitEmail?: string
  verification?: SandboxEnvironmentReport
  lifecycle?: SandboxLifecycleState
  name: string
  mountPath: string
  sandboxId?: string
  sshTargetId?: string
  tools: SandboxTool[]
  operationId: string
  status: 'provisioning' | 'ready' | 'error' | 'interrupted' | 'imported'
  stage: SandboxProvisionStage
  updatedAt: number
  logs: string[]
  versions: string[]
  error?: string
  network?: { beforeIds: string[]; createdIds: string[]; pending: boolean }
}

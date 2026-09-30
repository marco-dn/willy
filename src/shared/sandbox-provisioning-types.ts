export const SANDBOX_TOOLS = ['uv', 'claude', 'codex', 'databricks', 'orca-skills'] as const
export type SandboxTool = (typeof SANDBOX_TOOLS)[number]
export type SandboxProvisionRequest = {
  mode: 'create' | 'adopt' | 'resume'
  name: string
  mountPath: string
  createMount: boolean
  tools: SandboxTool[]
  sandboxId?: string
}
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
  name: string
  mountPath: string
  sandboxId?: string
  sshTargetId?: string
  tools: SandboxTool[]
  operationId: string
  status: 'provisioning' | 'ready' | 'error' | 'interrupted'
  stage: SandboxProvisionStage
  updatedAt: number
  logs: string[]
  versions: string[]
  error?: string
  network?: { beforeIds: string[]; createdIds: string[]; pending: boolean }
}

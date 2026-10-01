export type SandboxEnvironmentCheck = {
  id: string
  status: 'ok' | 'missing' | 'error' | 'blocked'
  detail: string
}
export type SandboxEnvironmentReport = {
  checkedAt: number
  outcome: 'ready' | 'needs-preparation' | 'unavailable'
  canPrepare: boolean
  checks: SandboxEnvironmentCheck[]
}

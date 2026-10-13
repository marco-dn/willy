import type { SandboxTarget } from './sandbox-policy-types'
export type SandboxLifecycleAction = 'start' | 'stop' | 'remove'
export type SandboxLifecycleState = {
  desired: 'running' | 'stopped' | 'removed'
  pending?: SandboxLifecycleAction
  error?: string
}
export type SandboxLifecycleSnapshot = {
  state: 'running' | 'stopped' | 'missing' | 'unavailable'
  projects: { id: string; name: string; linked: boolean }[]
  lifecycle?: SandboxLifecycleState
}
export type SandboxLifecycleRequest = {
  target: SandboxTarget
  action: SandboxLifecycleAction
  confirmedProjectIds?: string[]
  confirmName?: string
}

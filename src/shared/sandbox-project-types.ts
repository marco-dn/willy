import type { SandboxTarget } from './sandbox-policy-types'

export type SandboxProjectBinding = {
  sandboxId: string
  sandboxName: string
  sandboxBootId?: string
  sshTargetId: string
  setupId: string
  repoId: string
  mountPath: string
  projectPath: string
}

export type SandboxProjectLinkRequest = {
  target: SandboxTarget
  projectId: string
  relativePath: string
  cloneUrl?: string
  gitName?: string
  gitEmail?: string
}

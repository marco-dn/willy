import { z } from 'zod'

export const SandboxRuntimeProject = z.object({
  projectId: z.string().min(1),
  sandboxId: z.string().min(1),
  sandboxName: z.string().min(1),
  sandboxBootId: z.string().min(1),
  sshTargetId: z.string().min(1),
  mountPath: z.string().min(1),
  projectPath: z.string().min(1),
  worktreePath: z.string().min(1),
  kind: z.enum(['git', 'folder']),
  displayName: z.string().min(1)
})
export type SandboxRuntimeProjectRequest = z.infer<typeof SandboxRuntimeProject>

export const SandboxRuntimeProjectSelector = z.object({ projectId: z.string().min(1) })
export const SandboxRuntimePath = z.object({
  sandboxId: z.string(),
  sandboxBootId: z.string().optional(),
  mountPath: z.string(),
  path: z.string()
})

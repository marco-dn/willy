import { z } from 'zod'

const sandboxSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  agent: z.string().min(1),
  status: z.string().min(1),
  workspaces: z.array(z.string()).optional().default([])
})

const inventorySchema = z.object({ sandboxes: z.array(sandboxSchema) })
const versionSchema = z.object({
  client: z.object({ version: z.string().min(1) }),
  server: z.object({
    state: z.string().min(1),
    version: z.string().optional()
  })
})

export function parseSbxInventory(stdout: string): z.infer<typeof inventorySchema> {
  return inventorySchema.parse(JSON.parse(stdout))
}

export function parseSbxVersion(stdout: string): z.infer<typeof versionSchema> {
  return versionSchema.parse(JSON.parse(stdout))
}

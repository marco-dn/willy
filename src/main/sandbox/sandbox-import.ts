import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SandboxCommand } from './sandbox-command'
import { sandboxTargetSchema } from './sandbox-policy-response'
import type { SandboxProvisioningStore } from './sandbox-provisioning-store'
import { parseSbxInventory } from './sbx-response'

const importSchema = z
  .object({
    target: sandboxTargetSchema,
    mountPath: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !/\p{Cc}/u.test(value))
  })
  .strict()

export async function importSandboxRegistration(
  input: unknown,
  store: SandboxProvisioningStore,
  command: () => Promise<SandboxCommand>
): Promise<ManagedSandbox> {
  const request = importSchema.parse(input)
  if (!isAbsolute(request.mountPath)) {
    throw new Error('Choose an absolute shared folder reported by the sandbox.')
  }
  const run = await command()
  const inspect = async () => {
    const inventory = parseSbxInventory(await run(['ls', '--json'])).sandboxes
    const found = inventory.find((item) => item.id === request.target.id)
    if (
      !found ||
      found.name !== request.target.name ||
      found.agent !== 'shell' ||
      !found.workspaces.includes(request.mountPath)
    ) {
      throw new Error('Sandbox identity or shared folder changed. Refresh before importing.')
    }
  }
  await inspect()
  if (!(await stat(await realpath(request.mountPath))).isDirectory()) {
    throw new Error('The shared folder must be an existing directory.')
  }
  await inspect()
  const records = store.list()
  const existing = records.find((record) => record.sandboxId === request.target.id)
  if (existing) {
    if (
      existing.name !== request.target.name ||
      existing.mountPath !== request.mountPath ||
      existing.lifecycle?.desired === 'removed'
    ) {
      throw new Error('This sandbox has a conflicting management record. No changes were made.')
    }
    return existing
  }
  if (records.some((record) => record.name === request.target.name)) {
    throw new Error('This name already belongs to another saved sandbox. No changes were made.')
  }
  const record: ManagedSandbox = {
    name: request.target.name,
    sandboxId: request.target.id,
    mountPath: request.mountPath,
    status: 'imported',
    stage: 'verify',
    tools: [],
    operationId: randomUUID(),
    updatedAt: Date.now(),
    versions: [],
    logs: []
  }
  store.save(record)
  return structuredClone(record)
}

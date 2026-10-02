import { existsSync } from 'node:fs'
import { z } from 'zod'
import { SANDBOX_TOOLS, type ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import { writeSecureJsonFileWithinLimit } from '../../shared/bounded-secure-json-file'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import { sandboxGitIdentitySchema } from './sandbox-git-identity'

const name = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{1,62}$/)
const tools = z.array(z.enum(SANDBOX_TOOLS)).max(SANDBOX_TOOLS.length)
export const provisionRequestSchema = z
  .object({
    mode: z.enum(['create', 'adopt', 'resume']),
    name,
    mountPath: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !/\p{Cc}/u.test(value)),
    createMount: z.boolean(),
    tools,
    gitName: sandboxGitIdentitySchema.optional(),
    gitEmail: sandboxGitIdentitySchema.optional(),
    sandboxId: z.string().min(1).optional()
  })
  .strict()
  .refine((value) => Boolean(value.gitName) === Boolean(value.gitEmail), {
    message: 'Provide both Git author name and email.'
  })
const recordSchema = z.object({
  gitName: sandboxGitIdentitySchema.optional(),
  gitEmail: sandboxGitIdentitySchema.optional(),
  verification: z
    .object({
      checkedAt: z.number(),
      outcome: z.enum(['ready', 'needs-preparation', 'unavailable']),
      canPrepare: z.boolean(),
      checks: z
        .array(
          z.object({
            id: z.string().max(64),
            status: z.enum(['ok', 'missing', 'error', 'blocked']),
            detail: z.string().max(2000)
          })
        )
        .max(40)
    })
    .optional(),
  lifecycle: z
    .object({
      desired: z.enum(['running', 'stopped', 'removed']),
      pending: z.enum(['start', 'stop', 'remove']).optional(),
      error: z.string().optional()
    })
    .optional(),
  name,
  mountPath: z.string(),
  sandboxId: z.string().optional(),
  sshTargetId: z.string().optional(),
  tools,
  operationId: z.string(),
  status: z.enum(['provisioning', 'ready', 'error', 'interrupted', 'imported']),
  stage: z.enum([
    'sandbox',
    'ssh',
    'network',
    'base',
    ...SANDBOX_TOOLS,
    'verify',
    'connect',
    'cleanup'
  ]),
  updatedAt: z.number(),
  logs: z.array(z.string()).max(80),
  versions: z.array(z.string()),
  error: z.string().optional(),
  network: z
    .object({
      beforeIds: z.array(z.string()),
      createdIds: z.array(z.string()),
      pending: z.boolean()
    })
    .optional()
})
const storeSchema = z.object({ version: z.literal(1), records: z.array(recordSchema).max(200) })
const MAX_BYTES = 4 * 1024 * 1024

export class SandboxProvisioningStore {
  private records: ManagedSandbox[]
  constructor(private file: string) {
    this.records = existsSync(file)
      ? storeSchema.parse(
          JSON.parse(readNodeFileSyncWithinLimit(file, MAX_BYTES).buffer.toString('utf8'))
        ).records
      : []
  }
  list(): ManagedSandbox[] {
    return structuredClone(this.records)
  }
  save(record: ManagedSandbox): void {
    const records = this.records.filter((item) => item.name !== record.name).concat(record)
    const data = storeSchema.parse({ version: 1, records })
    writeSecureJsonFileWithinLimit(this.file, data, MAX_BYTES, { durable: true })
    this.records = data.records
  }
}

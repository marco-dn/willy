import { z } from 'zod'
import {
  normalizeSandboxDestination,
  type SandboxNetworkCheck,
  type SandboxPolicySnapshot
} from '../../shared/sandbox-policy-types'
import type { SandboxAccess } from './sandbox-command'
import { parseSandboxPolicy, sandboxTargetSchema } from './sandbox-policy-response'

const requestSchema = z
  .object({
    target: sandboxTargetSchema,
    action: z.enum(['list', 'add', 'remove', 'check']),
    destination: z.string().max(300).optional(),
    ruleId: z.string().max(200).optional()
  })
  .strict()
const checkSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  deny_kind: z.string().optional(),
  governance: z.object({ active: z.boolean() }).optional()
})
export class SandboxPolicyService {
  constructor(private acquire: (target: unknown) => Promise<SandboxAccess>) {}
  async execute(input: unknown): Promise<SandboxPolicySnapshot | SandboxNetworkCheck> {
    const request = requestSchema.parse(input)
    const destination =
      request.action === 'add' || request.action === 'check'
        ? normalizeSandboxDestination(request.destination ?? '', request.action === 'add')
        : undefined
    const { run, release } = await this.acquire(request.target)
    const name = request.target.name
    const list = async () => ({
      rules: parseSandboxPolicy(await run(['policy', 'ls', name, '--json']), name)
    })
    const check = async (target: string): Promise<SandboxNetworkCheck> => {
      const result = checkSchema.parse(
        JSON.parse(
          await run(
            [
              'policy',
              'check',
              'network',
              '--sandbox',
              name,
              '--protocol',
              'tcp',
              '--json',
              target
            ],
            { expectedExitCodes: [0, 1] }
          )
        )
      )
      return {
        target,
        allowed: result.allowed,
        reason: result.reason ?? null,
        denyKind: result.deny_kind ?? null,
        governanceActive: result.governance?.active === true
      }
    }
    try {
      if (request.action === 'check' && destination) {
        return await check(destination)
      }
      const snapshot = await list()
      if (request.action === 'list') {
        return snapshot
      }
      if (request.action === 'add' && destination) {
        if (!snapshot.rules.some((rule) => rule.editable && rule.resources.includes(destination))) {
          await run([
            'policy',
            'allow',
            'network',
            '--sandbox',
            name,
            '--protocol',
            'tcp',
            destination
          ])
        }
      } else if (request.action === 'remove') {
        const rule = snapshot.rules.find((rule) => rule.id === request.ruleId)
        if (!rule?.editable) {
          throw new Error(
            'This rule is inherited, read-only or has changed. Refresh before editing.'
          )
        }
        await run(['policy', 'rm', 'network', '--sandbox', name, '--id', rule.id, '--force'])
      }
      const updated = await list()
      return request.action === 'add' && destination && !destination.includes('*')
        ? { ...updated, check: await check(destination) }
        : updated
    } finally {
      release()
    }
  }
}

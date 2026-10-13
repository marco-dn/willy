import { z } from 'zod'
import type { SandboxNetworkRule } from '../../shared/sandbox-policy-types'

export const sandboxTargetSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9.-]{1,62}$/),
    id: z.string().min(1).max(200)
  })
  .strict()
export const sbxPolicyRulesSchema = z.object({
  rules: z.array(
    z.object({
      id: z.string(),
      scope: z.string(),
      resource_type: z.string(),
      decision: z.string(),
      resources: z.array(z.string()),
      actions: z.array(z.string()).optional().default([]),
      editable: z.boolean().optional(),
      layer: z.string().optional()
    })
  )
})
export function parseSandboxPolicy(stdout: string, name: string): SandboxNetworkRule[] {
  return sbxPolicyRulesSchema
    .parse(JSON.parse(stdout))
    .rules.filter((rule) => rule.resource_type === 'network')
    .map((rule) => ({
      id: rule.id,
      scope: rule.scope,
      layer: rule.layer ?? 'unknown',
      decision: rule.decision,
      resources: rule.resources,
      actions: rule.actions,
      editable:
        rule.scope === `sandbox:${name}` &&
        rule.layer === 'local' &&
        rule.editable === true &&
        rule.decision === 'allow' &&
        rule.actions.length === 1 &&
        rule.actions[0] === 'net:connect:tcp'
    }))
}

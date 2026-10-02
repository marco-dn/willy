import { z } from 'zod'
import type { ManagedSandbox } from '../../shared/sandbox-provisioning-types'
import type { SandboxCommand } from './sandbox-command'

import { sbxPolicyRulesSchema } from './sandbox-policy-response'

async function openRules(run: SandboxCommand, name: string): Promise<string[]> {
  const { rules } = sbxPolicyRulesSchema.parse(
    JSON.parse(await run(['policy', 'ls', name, '--json']))
  )
  return rules
    .filter(
      (rule) =>
        rule.scope === `sandbox:${name}` &&
        rule.resource_type === 'network' &&
        rule.decision === 'allow' &&
        rule.resources.includes('**') &&
        rule.actions.includes('net:connect:tcp') &&
        rule.editable === true &&
        rule.layer === 'local'
    )
    .map((rule) => rule.id)
}
export async function openProvisioningNetwork(
  run: SandboxCommand,
  record: ManagedSandbox,
  save: () => void
): Promise<void> {
  if (record.network) {
    throw new Error('Previous temporary network cleanup must finish first.')
  }
  const beforeIds = await openRules(run, record.name)
  if (beforeIds.length === 0) {
    record.network = { beforeIds, createdIds: [], pending: true }
    save()
    const output = await run([
      'policy',
      'allow',
      'network',
      '--sandbox',
      record.name,
      '--protocol',
      'tcp',
      '**'
    ])
    const id = /Rule added to policy local \(scope: sandbox:[^)]+\): ([a-f0-9-]{36}) /i.exec(
      output
    )?.[1]
    const added = id ? [id] : []
    if (!id || beforeIds.includes(id)) {
      throw new Error('Cannot identify the temporary TCP rule. Inspect sbx policy before resuming.')
    }
    record.network = { beforeIds, createdIds: added, pending: false }
    save()
    if (!(await openRules(run, record.name)).includes(id)) {
      throw new Error('Temporary TCP rule could not be verified.')
    }
  }
  for (const destination of ['example.net:443', 'example.net:80', 'ssh.github.com:443']) {
    const check = z
      .object({ allowed: z.boolean() })
      .parse(
        JSON.parse(
          await run(
            ['policy', 'check', 'network', '--sandbox', record.name, '--json', destination],
            { expectedExitCodes: [0, 1] }
          )
        )
      )
    if (!check.allowed) {
      throw new Error(
        `Network policy denies ${destination}. Organization policies must allow provisioning.`
      )
    }
  }
}
export async function cleanupProvisioningNetwork(
  run: SandboxCommand,
  record: ManagedSandbox,
  save: () => void
): Promise<void> {
  if (!record.network) {
    return
  }
  const existing = await openRules(run, record.name)
  if (record.network.pending) {
    const uncertain = existing.filter((id) => !record.network?.beforeIds.includes(id))
    if (uncertain.length) {
      throw new Error(
        `Interrupted before recording the temporary rule. Review these rules in a host terminal; remove the provisioning rule, then Resume: ${uncertain.map((id) => `sbx policy rm network --sandbox ${record.name} --id ${id} --force`).join('; ')}`
      )
    }
  } else {
    for (const id of record.network.createdIds) {
      if (existing.includes(id)) {
        await run(['policy', 'rm', 'network', '--sandbox', record.name, '--id', id, '--force'])
      }
    }
  }
  record.network = undefined
  save()
}

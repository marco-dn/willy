import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { parseSandboxEnvironmentProbe, sandboxEnvironmentProbe } from './sandbox-environment-probe'

it.skipIf(process.platform !== 'linux')(
  'executes a read-only probe with a quoted path and creates no files',
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "willy probe's folder-"))
    try {
      const result = await runProcess({
        program: '/bin/bash',
        args: ['-s'],
        input: sandboxEnvironmentProbe('uuid', dir, []),
        env: { ...process.env, SANDBOX_ID: 'uuid' },
        timeoutMs: 60_000,
        maxOutputBytes: 32_768
      })
      expect(result.code).toBe(0)
      const checks = parseSandboxEnvironmentProbe(result.stdout, [])
      expect(checks).toContainEqual({ id: 'identity', status: 'ok', detail: 'uuid' })
      expect(checks).toContainEqual({ id: 'mount', status: 'ok', detail: dir })
      expect(readdirSync(dir)).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
it.skipIf(process.platform !== 'linux')(
  'stops before checking tools on a different SSH host',
  async () => {
    const result = await runProcess({
      program: '/bin/bash',
      args: ['-s'],
      input: sandboxEnvironmentProbe('expected', '/not-needed', []),
      env: { ...process.env, SANDBOX_ID: 'different' },
      timeoutMs: 5_000
    })
    expect(parseSandboxEnvironmentProbe(result.stdout, [])).toEqual([
      {
        id: 'identity',
        status: 'error',
        detail: 'The SSH alias did not report the selected sandbox UUID.'
      }
    ])
  }
)

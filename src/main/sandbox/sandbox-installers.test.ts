import { describe, expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { SANDBOX_TOOLS } from '../../shared/sandbox-provisioning-types'
import {
  baseInstaller,
  sandboxScript,
  toolInstaller,
  verificationScript,
  verifiedSandboxVersions
} from './sandbox-installers'

describe('sandbox installer scripts', () => {
  it.skipIf(process.platform === 'win32')(
    'installs both skills when the installer reads stdin from a streamed SSH script',
    async () => {
      const result = await runProcess({
        program: '/bin/bash',
        args: ['-s'],
        input: `set -euo pipefail
npx() { cat >/dev/null; printf '%s\\n' "$*"; }
${toolInstaller('orca-skills')}
printf 'installation-finished\\n'
`,
        timeoutMs: 5000
      })
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain('--skill orchestration')
      expect(result.stdout).toContain('--skill orca-cli')
      expect(result.stdout).toContain('installation-finished')
    }
  )
  it.skipIf(process.platform === 'win32')(
    'generates valid Bash for every stage and quoted mount paths',
    async () => {
      for (const body of [
        baseInstaller,
        ...SANDBOX_TOOLS.map(toolInstaller),
        verificationScript([...SANDBOX_TOOLS])
      ]) {
        const result = await runProcess({
          program: '/bin/bash',
          args: ['-n'],
          input: sandboxScript(
            body,
            "/work/it's $(printf unexpected)",
            '12345678-1234-4234-8234-123456789abc'
          ),
          timeoutMs: 5000
        })
        expect(result.code, result.stderr).toBe(0)
      }
    }
  )
  it.skipIf(process.platform !== 'linux')(
    'refuses an SSH guest with a different boot identity before running its body',
    async () => {
      const result = await runProcess({
        program: '/bin/bash',
        args: ['-s'],
        input: sandboxScript('printf unexpected', '/tmp', '00000000-0000-0000-0000-000000000000'),
        timeoutMs: 5000
      })
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('unexpected')
      expect(result.stderr).toContain('SSH alias does not reach the selected sandbox')
    }
  )
  it('rejects a successful SSH command that did not return every verified tool', () => {
    expect(() => verifiedSandboxVersions('', [])).toThrow('did not report python3')
    const base = ['python3', 'git', 'curl', 'node', 'npm', 'make', 'cc', 'just', 'zsh']
      .map((tool) => `WILLY_TOOL ${tool} test-version`)
      .join('\n')
    expect(() => verifiedSandboxVersions(base, ['uv'])).toThrow('did not report uv')
    expect(verifiedSandboxVersions(base, [])).toHaveLength(9)
  })
  it('verifies only selected optional tools plus the required base', () => {
    const script = verificationScript(['uv'])
    expect(script).toContain('git --version')
    expect(script).toContain('uv --version')
    expect(script).not.toContain('codex --version')
    expect(script).not.toContain('databricks --version')
  })
  it('installs both bundled skill choices for both agents', () => {
    expect(toolInstaller('orca-skills')).toContain('--skill orchestration -a claude-code -a codex')
    expect(toolInstaller('orca-skills')).toContain('--skill orca-cli -a claude-code -a codex')
    expect(verificationScript(['orca-skills'])).toContain('test -f')
  })
})

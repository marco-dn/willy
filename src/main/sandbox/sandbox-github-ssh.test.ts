import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { sandboxGithubSshScript } from './sandbox-github-ssh'

it.skipIf(process.platform === 'win32')(
  'configures GitHub on fresh and existing sandboxes without duplicating or losing SSH settings',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sandbox-github-ssh-'))
    const config = join(directory, '.ssh', 'config')
    const original = 'ServerAliveInterval 30\nHost *\n    Port 22\nHost gitlab.com\n    User git\n'
    try {
      for (const existing of [false, true]) {
        if (existing) {
          await writeFile(config, original)
        }
        const run = () =>
          runProcess({
            program: 'python3',
            args: [
              '-c',
              `import sys
from pathlib import Path
from unittest.mock import patch
body = sys.stdin.read().split("WILLY_GITHUB_SSH'\\n", 1)[1].rsplit('WILLY_GITHUB_SSH', 1)[0]
with patch('pathlib.Path.home', return_value=Path(sys.argv[1])):
    exec(body)
`,
              directory
            ],
            input: sandboxGithubSshScript,
            timeoutMs: 5000
          })
        const first = await run()
        expect(first.code, first.stderr).toBe(0)
        const content = await readFile(config, 'utf8')
        const second = await run()
        expect(second.code, second.stderr).toBe(0)
        expect(await readFile(config, 'utf8')).toBe(content)
        if (existing) {
          expect(content.endsWith(original)).toBe(true)
        }
        expect((await stat(config)).mode & 0o777).toBe(0o600)
        expect((await stat(join(directory, '.ssh'))).mode & 0o777).toBe(0o700)
        for (const host of ['github.com', 'gitlab.com']) {
          const resolved = await runProcess({
            program: 'ssh',
            args: ['-G', '-F', config, host],
            timeoutMs: 5000
          })
          expect(resolved.code, resolved.stderr).toBe(0)
          expect(resolved.stdout).toContain(
            host === 'github.com' ? 'hostname ssh.github.com' : 'hostname gitlab.com'
          )
          expect(resolved.stdout).toContain(host === 'github.com' ? 'port 443' : 'port 22')
          if (existing) {
            expect(resolved.stdout).toContain('serveraliveinterval 30')
          }
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

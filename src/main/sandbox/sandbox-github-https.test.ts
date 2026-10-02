import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { runProcess } from '../../shared/child-process/run-process'
import { sandboxGithubHttpsScript } from './sandbox-github-https'
import { baseInstaller } from './sandbox-installers'

it.skipIf(process.platform === 'win32')(
  'uses HTTPS for GitHub fetch and push without changing mounted remotes or other providers',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sandbox-github-https-'))
    const env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: join(directory, 'gitconfig'),
      GIT_CONFIG_NOSYSTEM: '1'
    }
    const run = async (program: string, args: string[], input?: string) => {
      const result = await runProcess({ program, args, input, env, cwd: directory, timeoutMs: 5000 })
      expect(result.code, result.stderr).toBe(0)
      return result.stdout.trim()
    }
    try {
      expect(baseInstaller).toContain(sandboxGithubHttpsScript)
      await run('git', ['init', '--quiet'])
      await run('git', ['config', '--global', 'user.name', 'Existing Name'])
      await run('bash', ['-eu', '-s'], sandboxGithubHttpsScript)
      const config = await readFile(env.GIT_CONFIG_GLOBAL, 'utf8')
      await run('bash', ['-eu', '-s'], sandboxGithubHttpsScript)
      expect(await readFile(env.GIT_CONFIG_GLOBAL, 'utf8')).toBe(config)
      expect(await run('git', ['config', '--global', 'user.name'])).toBe('Existing Name')
      for (const url of [
        'git@github.com:company/project.git',
        'ssh://git@github.com/company/project.git',
        'ssh://git@github.com:22/company/project.git',
        'https://github.com/company/project.git',
        'git@gitlab.com:company/project.git'
      ]) {
        await run('git', ['config', 'remote.origin.url', url])
        await run('git', ['config', 'remote.origin.pushurl', url])
        const expected = url.includes('github.com') ? 'https://github.com/company/project.git' : url
        expect(await run('git', ['remote', 'get-url', 'origin'])).toBe(expected)
        expect(await run('git', ['remote', 'get-url', '--push', 'origin'])).toBe(expected)
        expect(await run('git', ['config', '--local', 'remote.origin.url'])).toBe(url)
      }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
)

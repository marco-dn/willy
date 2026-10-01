import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcess } from '../../shared/child-process/run-process'
import { sandboxProjectSetupScript, parseSandboxProjectSetup } from './sandbox-project-setup'
const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    await rm(dir, { recursive: true, force: true })
  }
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'willy-project-paths-'))
  directories.push(root)
  const mount = join(root, 'shared folder')
  await mkdir(mount)
  return {
    root,
    mount,
    project: join(mount, 'project'),
    bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
  }
}
async function verify(input: Awaited<ReturnType<typeof fixture>>, kind: 'git' | 'folder') {
  return runProcess({
    program: 'bash',
    args: ['-s'],
    input: sandboxProjectSetupScript({
      mountPath: input.mount,
      projectPath: input.project,
      worktreePath: join(input.mount, 'worktrees'),
      bootId: input.bootId,
      kind,
      gitName: 'Sandbox Test',
      gitEmail: 'sandbox-test@example.invalid'
    }),
    timeoutMs: 5000,
    maxOutputBytes: 16_384
  })
}
describe.skipIf(process.platform !== 'linux')(
  'sandbox project path verification on real temporary folders',
  () => {
    it('checks Git metadata and writes repository-local identity with paths containing spaces', async () => {
      const input = await fixture()
      expect(
        (
          await runProcess({
            program: 'git',
            args: ['init', '--quiet', input.project],
            timeoutMs: 5000,
            maxOutputBytes: 4096
          })
        ).code
      ).toBe(0)
      const result = await verify(input, 'git')
      expect(result.code, result.stderr).toBe(0)
      expect(parseSandboxProjectSetup(result.stdout).projectPath).toBe(input.project)
      const identity = await runProcess({
        program: 'git',
        args: ['config', '--local', '--get', 'user.email'],
        cwd: input.project,
        timeoutMs: 5000,
        maxOutputBytes: 4096
      })
      expect(identity.stdout.trim()).toBe('sandbox-test@example.invalid')
    })
    it('accepts two non-Git project folders within a mount containing spaces', async () => {
      const input = await fixture()
      await mkdir(input.project)
      const second = { ...input, project: join(input.mount, 'second project') }
      await mkdir(second.project)
      for (const project of [input, second]) {
        const result = await verify(project, 'folder')
        expect(result.code, result.stderr).toBe(0)
        expect(parseSandboxProjectSetup(result.stdout).projectPath).toBe(project.project)
      }
    })
    it('rejects a Git directory outside the mount', async () => {
      const input = await fixture()
      expect(
        (
          await runProcess({
            program: 'git',
            args: [
              'init',
              '--quiet',
              '--separate-git-dir',
              join(input.root, 'external-git'),
              input.project
            ],
            timeoutMs: 5000,
            maxOutputBytes: 4096
          })
        ).code
      ).toBe(0)
      const result = await verify(input, 'git')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('outside the shared folder')
    })
    it('rejects a folder symlink escaping the mount', async () => {
      const input = await fixture()
      const outside = join(input.root, 'outside')
      await mkdir(outside)
      await symlink(outside, input.project)
      const result = await verify(input, 'folder')
      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('outside the shared folder')
    })
  }
)

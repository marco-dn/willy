import { describe, expect, it } from 'vitest'
import {
  sandboxProjectLinkSchema,
  sandboxProjectPath,
  sandboxProjectSetupScript,
  parseSandboxProjectSetup
} from './sandbox-project-setup'

describe('sandbox project setup validation', () => {
  it.each(['/outside', '../outside', 'sub/../../outside', 'sub\\outside', 'sub\ncommand'])(
    'rejects escaping path %j',
    (relativePath) => {
      expect(() =>
        sandboxProjectLinkSchema.parse({
          target: { name: 'demo', id: 'id' },
          projectId: 'p',
          relativePath
        })
      ).toThrow()
    }
  )
  it('supports the mount itself and paths with spaces', () => {
    expect(sandboxProjectPath('/shared space', '.')).toBe('/shared space')
    expect(sandboxProjectPath('/shared space', 'my project')).toBe('/shared space/my project')
  })
  it('keeps user text out of shell syntax', () => {
    const script = sandboxProjectSetupScript({
      mountPath: '/shared',
      projectPath: '/shared/$(touch surprise)',
      worktreePath: '/shared/worktrees',
      bootId: 'boot',
      kind: 'git',
      gitName: "O'Connor; $(whoami)",
      gitEmail: 'name@example.org'
    })
    expect(script).not.toContain('$(touch surprise)')
    expect(script).not.toContain('$(whoami)')
    expect(script).toContain("['git', 'clone', '--', p['cloneUrl'], project]")
    expect(script).toContain("'--git-common-dir'")
  })
  it('requires a successful structured verification result', () => {
    expect(() => parseSandboxProjectSetup('incomplete')).toThrow('did not complete')
    expect(() => parseSandboxProjectSetup('WILLY_PROJECT_SETUP={"projectPath":null}')).toThrow()
    expect(
      parseSandboxProjectSetup(
        'noise\nWILLY_PROJECT_SETUP={"projectPath":"/shared/p","worktreePath":"/shared/w"}'
      )
    ).toEqual({ projectPath: '/shared/p', worktreePath: '/shared/w' })
  })
})

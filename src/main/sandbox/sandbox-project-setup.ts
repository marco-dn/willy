import { posix } from 'node:path'
import { z } from 'zod'
import { sandboxTargetSchema } from './sandbox-policy-response'
import { sandboxContainsPath } from './sandbox-execution-policy'
import { sandboxGitIdentitySchema as identity } from './sandbox-git-identity'

export const sandboxProjectLinkSchema = z
  .object({
    target: sandboxTargetSchema,
    projectId: z.string().min(1).max(512),
    relativePath: z
      .string()
      .trim()
      .max(4096)
      .refine(
        (value) =>
          !value.startsWith('/') &&
          !value.includes('\\') &&
          !value.split('/').includes('..') &&
          !/\p{Cc}/u.test(value)
      ),
    cloneUrl: z
      .string()
      .trim()
      .min(1)
      .max(4096)
      .refine(
        (value) => !value.startsWith('-') && !/\p{Cc}/u.test(value) && validCloneUrl(value),
        'Use an HTTP(S), SSH or Git repository URL without embedded credentials.'
      )
      .optional(),
    gitName: identity.optional(),
    gitEmail: identity.optional()
  })
  .strict()

function validCloneUrl(value: string): boolean {
  if (/^[a-zA-Z0-9_.-]+@[^:\s/]+:[^\s]+$/.test(value)) {
    return true
  }
  try {
    const url = new URL(value)
    return (
      ['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.password &&
      (url.protocol === 'ssh:' || !url.username) &&
      !url.search &&
      !url.hash
    )
  } catch {
    return false
  }
}

export function sandboxProjectPath(mountPath: string, relativePath: string): string {
  const path = posix.join(mountPath, relativePath || '.')
  if (!sandboxContainsPath(mountPath, path)) {
    throw new Error('Choose a path inside the sandbox shared folder.')
  }
  return path
}

export function sandboxProjectSetupScript(input: {
  mountPath: string
  projectPath: string
  worktreePath: string
  kind: 'git' | 'folder'
  bootId: string
  cloneUrl?: string
  gitName?: string
  gitEmail?: string
}): string {
  const payload = Buffer.from(JSON.stringify(input)).toString('base64')
  return `set -eu
python3 - <<'WILLY_PROJECT_SETUP'
import base64, json, os, subprocess
p = json.loads(base64.b64decode('${payload}'))
with open('/proc/sys/kernel/random/boot_id') as f:
    if f.read().strip() != p['bootId']:
        raise RuntimeError('SSH target is not the selected sandbox')
mount = os.path.realpath(p['mountPath'])
def contained(path):
    result = os.path.realpath(path)
    if os.path.commonpath([mount, result]) != mount:
        raise RuntimeError('Path or Git metadata is outside the shared folder: ' + path)
    return result
project = contained(p['projectPath'])
worktrees = contained(p['worktreePath'])
if p.get('cloneUrl'):
    if os.path.exists(project):
        raise RuntimeError('Clone destination already exists; select the existing-folder option')
    parent = contained(os.path.dirname(project))
    if not os.path.isdir(parent):
        raise RuntimeError('Clone parent folder does not exist')
    subprocess.run(['git', 'clone', '--', p['cloneUrl'], project], cwd=parent, check=True)
if not os.path.isdir(project):
    raise RuntimeError('Project folder does not exist inside the sandbox')
if p['kind'] == 'git':
    def git(*args):
        return subprocess.check_output(['git', *args], cwd=project, text=True).strip()
    if os.path.realpath(git('rev-parse', '--show-toplevel')) != project:
        raise RuntimeError('Select the root of the Git repository')
    for field in ['--git-dir', '--git-common-dir']:
        value = git('rev-parse', field)
        contained(value if os.path.isabs(value) else os.path.join(project, value))
    if p.get('gitName'):
        git('config', '--local', 'user.name', p['gitName'])
    if p.get('gitEmail'):
        git('config', '--local', 'user.email', p['gitEmail'])
    def identity(key):
        result = subprocess.run(['git', 'config', '--get', key], cwd=project, text=True, capture_output=True)
        return result.stdout.strip() if result.returncode == 0 else ''
    name, email = identity('user.name'), identity('user.email')
    if not name or not email:
        raise RuntimeError('Set a Git name and email for this repository')
    git('config', '--local', 'user.name', name)
    git('config', '--local', 'user.email', email)
os.makedirs(worktrees, exist_ok=True)
contained(worktrees)
print('WILLY_PROJECT_SETUP=' + json.dumps({'projectPath': project, 'worktreePath': worktrees}))
WILLY_PROJECT_SETUP
`
}

export function parseSandboxProjectSetup(output: string): {
  projectPath: string
  worktreePath: string
} {
  const marker = output.split('\n').findLast((line) => line.startsWith('WILLY_PROJECT_SETUP='))
  if (!marker) {
    throw new Error('Sandbox project verification did not complete.')
  }
  return z
    .object({ projectPath: z.string().min(1), worktreePath: z.string().min(1) })
    .parse(JSON.parse(marker.slice('WILLY_PROJECT_SETUP='.length)))
}

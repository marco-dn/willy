import { quotePosixShell } from '../../shared/wsl-login-shell-command'
import type { SandboxTool } from '../../shared/sandbox-provisioning-types'
import type { SandboxEnvironmentCheck } from '../../shared/sandbox-environment-types'
import { SANDBOX_BASE_TOOLS } from './sandbox-installers'

export function sandboxEnvironmentProbe(id: string, mount: string, tools: SandboxTool[]): string {
  const commands = [
    ...SANDBOX_BASE_TOOLS,
    'flock',
    ...tools.filter((tool) => tool !== 'orca-skills')
  ]
  return `set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
report() {
  printf 'WILLY_ENV %s %s %s\\n' "$1" "$2" "$(printf '%s' "$3" | head -c 1024 | base64 | tr -d '\\n')"
}
if [[ "\${SANDBOX_ID:-}" != ${quotePosixShell(id)} ]]; then
  report identity error 'The SSH alias did not report the selected sandbox UUID.'
  exit 0
fi
report identity ok "$SANDBOX_ID"
if [[ -d ${quotePosixShell(mount)} ]]; then report mount ok ${quotePosixShell(mount)}; else report mount error 'Shared folder is unavailable inside the guest.'; exit 0; fi
if [[ -s /etc/ssl/certs/ca-certificates.crt || -s /etc/pki/tls/certs/ca-bundle.crt ]]; then report certificates ok 'CA certificate bundle found'; else report certificates missing 'CA certificate bundle not found'; fi
report platform ok "$(uname -s) $(uname -m)"
if libc=$(getconf GNU_LIBC_VERSION 2>/dev/null); then report libc ok "$libc"; else report libc error 'Could not verify the guest libc.'; fi
${commands
  .map(
    (tool) => `if ! command -v ${tool} >/dev/null 2>&1; then
  report ${tool} missing 'Command not found'
elif version=$(timeout 5 ${tool} --version 2>/dev/null); then
  report ${tool} ok "$(printf '%s' "$version" | head -n 1)"
else
  report ${tool} error 'Version check failed or timed out'
fi`
  )
  .join('\n')}
${tools.includes('orca-skills') ? `if [[ -f "$HOME/.claude/skills/orchestration/SKILL.md" && -f "$HOME/.claude/skills/orca-cli/SKILL.md" && -f "$HOME/.agents/skills/orchestration/SKILL.md" && -f "$HOME/.agents/skills/orca-cli/SKILL.md" ]]; then report orca-skills ok verified; else report orca-skills missing 'Required skill files are missing'; fi` : ''}
`
}
export function parseSandboxEnvironmentProbe(
  output: string,
  tools: SandboxTool[]
): SandboxEnvironmentCheck[] {
  const checks: SandboxEnvironmentCheck[] = []
  const seen = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith('WILLY_ENV ')) {
      continue
    }
    const match = /^WILLY_ENV ([a-z0-9-]+) (ok|missing|error) ([A-Za-z0-9+/=]+)$/.exec(line)
    if (!match || seen.has(match[1])) {
      throw new Error('Invalid or duplicate environment probe result.')
    }
    const [, id, status, encoded] = match
    if (status !== 'ok' && status !== 'missing' && status !== 'error') {
      throw new Error('Invalid probe status.')
    }
    const detail = Buffer.from(encoded, 'base64').toString('utf8')
    if (detail.length > 1024) {
      throw new Error('Environment probe result is too large.')
    }
    seen.add(id)
    checks.push({ id, status, detail })
  }
  if (!checks.some((check) => check.id === 'identity')) {
    throw new Error('Environment identity probe did not return a result.')
  }
  if (
    checks.some(
      (check) => (check.id === 'identity' || check.id === 'mount') && check.status !== 'ok'
    )
  ) {
    return checks
  }
  for (const id of [
    'mount',
    'certificates',
    'platform',
    'libc',
    ...SANDBOX_BASE_TOOLS,
    'flock',
    ...tools
  ]) {
    if (!seen.has(id)) {
      throw new Error(`Environment probe did not report ${id}.`)
    }
  }
  return checks
}

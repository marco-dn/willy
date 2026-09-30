import type { SandboxTool } from '../../shared/sandbox-provisioning-types'
import { quotePosixShell } from '../../shared/wsl-login-shell-command'

const installers: Record<Exclude<SandboxTool, 'orca-skills'>, { url: string; shell: string }> = {
  uv: { url: 'https://astral.sh/uv/install.sh', shell: 'sh' },
  claude: { url: 'https://claude.ai/install.sh', shell: 'bash' },
  codex: { url: 'https://chatgpt.com/codex/install.sh', shell: 'sh' },
  databricks: {
    url: 'https://raw.githubusercontent.com/databricks/setup-cli/main/install.sh',
    shell: 'sudo -n sh'
  }
}
export function sandboxScript(body: string, mountPath: string, bootId: string): string {
  return `set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
[[ "$(uname -s)" = Linux ]] || { echo 'A Linux sandbox is required.' >&2; exit 1; }
[[ "$(cat /proc/sys/kernel/random/boot_id)" = ${quotePosixShell(bootId)} ]] || { echo 'SSH alias does not reach the selected sandbox. Check SSH configuration and resume.' >&2; exit 1; }
[[ -d ${quotePosixShell(mountPath)} ]] || { echo 'Shared folder is unavailable.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'The sandbox needs util-linux (flock).' >&2; exit 1; }
mkdir -p "$HOME/.local/state/willy-sbx"
exec 9>"$HOME/.local/state/willy-sbx/provision.lock"
flock -n 9 || { echo 'An earlier provisioning command is still running. Retry later.' >&2; exit 1; }
${body}
`
}
const bashPrompt = String.raw`PS1='\[\e[1;36m\]\u@\h\[\e[0m\]:\[\e[1;34m\]\W\[\e[0m\]\$ '`
export const baseInstaller = `sudo -n apt-get update
sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3 git curl ca-certificates nodejs npm just zsh
path_line='export PATH="$HOME/.local/bin:$PATH"'
for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
  touch "$rc"
  grep -Fqx "$path_line" "$rc" || printf '%s\\n' "$path_line" >> "$rc"
done
prompt_line=${quotePosixShell(bashPrompt)}
grep -Fqx "$prompt_line" "$HOME/.bashrc" || printf '%s\\n' "$prompt_line" >> "$HOME/.bashrc"
`
export function toolInstaller(tool: SandboxTool): string {
  if (tool === 'orca-skills') {
    return ['orchestration', 'orca-cli']
      .map(
        (skill) =>
          `npx --yes skills add https://github.com/stablyai/orca --skill ${skill} -a claude-code -a codex -y --global`
      )
      .join('\n')
  }
  const { url, shell } = installers[tool]
  return `if ! command -v ${tool} >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl --connect-timeout 15 --max-time 300 -fsSL ${quotePosixShell(url)} -o "$installer"
  ${shell} "$installer"
fi`
}
const baseTools = ['python3', 'git', 'curl', 'node', 'npm', 'make', 'cc', 'just', 'zsh']
export function verifiedSandboxVersions(output: string, tools: SandboxTool[]): string[] {
  const lines = output.split('\n')
  return [...baseTools, ...tools].map((tool) => {
    const prefix = `WILLY_TOOL ${tool} `
    const line = lines.find((line) => line.startsWith(prefix) && line.length > prefix.length)
    if (!line) {
      throw new Error(
        `Installed-tool verification did not report ${tool}. Provisioning is incomplete.`
      )
    }
    return line.slice(11, 311)
  })
}
export function verificationScript(tools: SandboxTool[]): string {
  const commands = [...baseTools, ...tools.filter((tool) => tool !== 'orca-skills')]
  const verify = commands
    .map(
      (tool) => `${tool} --version >/dev/null
version=$(${tool} --version)
printf 'WILLY_TOOL %s %s\\n' ${tool} "$(printf '%s' "$version" | head -n 1)"`
    )
    .join('\n')
  const skills = tools.includes('orca-skills')
    ? `
for skill in orchestration orca-cli; do
  for agent in .claude .agents; do
    test -f "$HOME/$agent/skills/$skill/SKILL.md" || { echo "Missing $agent skill: $skill" >&2; exit 1; }
  done
done
printf 'WILLY_TOOL orca-skills verified\\n'`
    : ''
  return verify + skills
}

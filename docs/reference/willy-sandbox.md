# Willy Sandbox: provisioning

Settings → Sandbox manages local Docker `sbx` shell sandboxes. Install `sbx`, complete
its login if required, and start its local daemon outside Willy. OpenSSH must be on
the host. The Linux shell template needs `sudo` without a password, `apt-get` and
`flock`. Willy does not provision sandboxes on remote SSH hosts or in the cloud.

## Create or adopt

Choose **Create sandbox**, enter a name and an absolute shared folder, or use
**Choose folder**. A missing directory is created only when the checkbox explicitly
requests it. Names use 2–63 letters, digits, dots or hyphens and start with a letter
or digit. `default` is reserved.

Use **Adopt NAME** for an existing shell sandbox. Willy checks its observed ID,
agent and shared folder before provisioning; it does not create a duplicate.
The first reported shared folder is used when a sandbox has multiple mounts.
The name and shared folder remain fixed when resuming a managed sandbox.

Provisioning starts a stopped sandbox. The required base contains Python, Git,
curl, CA certificates, Node.js, npm, build tools, just and zsh. uv, Claude Code,
Codex CLI, Databricks CLI and the Orca orchestration / CLI skills are selected by
default and can be deselected independently. Deselecting an installed tool never
uninstalls it. Remote installers are included in Willy's TypeScript implementation;
an externally installed `orca-sbx` skill or host Python installation is unnecessary.
No tool login, Databricks profile selection or Git identity is performed here.

## Progress and retry

The main process owns the operation. Closing settings does not stop it. The phase,
bounded recent log and verified versions reappear when settings reopen. Operations
run one at a time, and remote installer commands use a `flock` lock so retry cannot
overlap an earlier command still running after loss of contact.

Configuration and incomplete operations are stored atomically in
`willy-sandboxes.json` under the application's user-data directory. Restarting Willy
marks unfinished provisioning as interrupted and attempts temporary network cleanup.
**Resume / configure** reruns idempotent provisioning with the current tool selection.
If the daemon is unavailable, start it outside Willy and refresh. If the sandbox ID
or mount changed, Willy refuses to modify or silently recreate it.

`sbx setup ssh` provides the `<name>.sbx` alias and ProxyCommand. Willy reuses a
matching SSH target without rewriting its settings. Before each remote stage, the
SSH guest boot ID must match the one read through `sbx exec`; an alias pointing at
another machine is rejected before installer commands run. Conflicting targets must be
reviewed in SSH settings. A successful operation verifies tools, connects the SSH
target and completes network cleanup before displaying **Ready**. This is provisioning
status; the separate diagnostic list shows the observed running/stopped state.

## Temporary network access

Installation temporarily allows outbound TCP only for the selected sandbox.
Existing rules and organization policy remain in place; a policy denial fails the
operation. Willy saves the exact rule ID returned by sbx and removes only that ID
on completion, failure or recovery. A pre-existing sandbox-wide allow rule is reused
and never removed. UDP is not enabled.

The sbx CLI does not accept a caller-chosen rule ID. A power loss between rule creation
and saving its returned ID leaves uncertain ownership. Willy does **not** infer ownership
from a before/after difference. It blocks resume and displays candidate rule IDs and
host-terminal removal commands. Inspect `sbx policy ls NAME --json`, remove only the
rule belonging to the interrupted installation, then resume. Until this is resolved,
the temporary access may remain open. If the sandbox was replaced, no cleanup is
attempted against its replacement.

## Manual UI check

1. Open Settings → Sandbox and verify diagnostics are ready.
2. Create a disposable sandbox with a path containing spaces; request folder creation
   explicitly. Leave only uv selected to keep the test small.
3. Close and reopen settings during installation. The phase should still be visible
   and a second provisioning operation should be disabled.
4. Wait for Ready, installed versions and the SSH host in SSH settings.
5. Adopt an existing shell sandbox. Its ID and mount should be preserved and no
   second sandbox created.
6. On failure, read the phase/error, fix the prerequisite, then use Resume / configure.
   Restarting the app during provisioning must show Interrupted, never a false Ready.

Project binding, sandbox-only execution, credential setup, network editing and
lifecycle buttons are delivered in later implementation tasks. Shared files remain
accessible to other applications on the host.

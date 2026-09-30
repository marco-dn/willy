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

Project binding, sandbox-only execution and lifecycle buttons are delivered in later implementation tasks. Shared files remain
accessible to other applications on the host.

## Network rules (Step 3)

Open **Network and credentials** on a managed sandbox. Adopt an existing sandbox
first if it only appears in diagnostics. The editor accepts ASCII domains (or
punycode), `*.example.com`, `**.example.com`, and an optional TCP port from 1 to 65535. URLs, arbitrary glob expressions and the universal `**` destination are
not accepted by this editor.

The first group contains removable, local TCP allow rules scoped to this sandbox.
Global rules, organization policies, deny rules and rules that also affect UDP
remain visible in the read-only group. Removal rechecks the rule ID, scope and
editability; it never removes a rule by matching its destination alone.

Adding a concrete destination also checks its effective policy. **Check access**
can test an existing destination without changing rules; the default port is 443.
For wildcards, test an actual host separately: a sample host cannot prove coverage
of an entire wildcard. Denials display sbx's reason and denial type, plus the
presence of organization governance. This is a policy check, not a live TCP probe.
An allow rule cannot override an organization denial.

Provisioning, policy operations and credential prompts share an operation lock.
An unresolved temporary provisioning rule must be cleaned up before other changes.
The backend checks sandbox identity and mount even if a stale window submits a
request after the sandbox was replaced externally.

## Optional GitHub API credentials (Step 3)

**Open GitHub credential prompt** starts the host's `sbx secret set github
--sandbox NAME` in a dedicated integrated PTY, with CLI debug output disabled.
Enter the token only in that terminal. Willy supplies neither a token argument
nor an existing token from another tool.

This terminal uses no project session, terminal daemon, shell history, replay
buffer or saved session log. Its input/output is sent only to the owning window;
xterm has no scrollback or diagnostic logging and is disposed when the command
ends. Closing the prompt, leaving settings or closing/reloading its window cancels
the PTY. A forgotten prompt expires after 15 minutes. Cleanup waits for the PTY's
exit before releasing the sandbox operation lock.

The token is stored by sbx, not in Willy's settings or provisioning journal. The
UI reports the outcome of the prompt; it does not persist or infer an authenticated
account. Cancellation does not claim credentials were configured or revoke an
existing credential. If sbx already saved a token, closing the prompt does not
undo that action.

GitHub API/service credentials and Git clone/push authentication are distinct.
Git still uses its configured HTTPS credential helper or SSH identity/agent; this
panel does not configure those mechanisms or verify Git access. Credentials are
optional and do not affect whether the sandbox can be provisioned or used.

### Manual check

1. Open Network and credentials on two managed sandboxes and note their rules.
2. Add `example.org:443` to the first. Its local rule should appear; the second
   sandbox's rules must remain unchanged. Check access and read the policy result.
3. Remove the new rule from the first sandbox. Inherited policies must stay intact.
4. Open the GitHub prompt and cancel without entering a token. No configured-account
   badge should appear. Network controls should become usable again after PTY exit.
5. Close settings while the prompt is open, then reopen them. There must be no
   restored terminal transcript or credential value.

## Project associations (Step 4)

Expand **Projects** on a ready sandbox. Select an existing Willy project and a
relative path inside its shared folder (`.` selects the mount itself). This is an
explicit association: GitHub, GitLab, repositories without remotes and folder
projects use the same flow. Existing-folder linking does not copy files. Git
projects can instead be cloned via SSH into a new destination whose parent already
exists. URLs must not embed HTTP credentials; configure Git authentication separately.

For Git projects, enter an author name and email, or leave them blank to reuse the
identity available inside the sandbox. Verification saves that identity with
`git config --local`; it does not change global Git identity. Git metadata outside
the mount and symlinks escaping it are rejected. New worktrees use a per-project
folder under `<mount>/.willy-worktrees/`.

Linking refuses while project operations or sessions on other hosts are active.
Unverifiable SSH sessions also block the change: disconnection or an expired lease
is not evidence that a process exited. Reconnect and close the sessions first.
A project can have one active sandbox; several projects can share a sandbox.

The backend checks terminal, agent, Git, hook and workspace creation entry points,
including runtime/CLI requests and automation launches. The composer offers the
sandbox environment for a linked project. A stopped/replaced sandbox, changed
mount or missing SSH connection blocks execution; Willy does not fall back to local
execution. Existing local workspaces and history remain registered, but their
execution is refused while linked. Shared files remain available to other host apps.

Closing settings does not cancel a link request already running in the main
process. Reopen Projects to see the saved association. A failed preflight does not
activate the sandbox constraint; a clone or Git configuration already performed
may remain in the shared folder and can be selected as an existing folder on retry.

**Unlink project** requires its sandbox sessions to be closed. It clears only that
project's constraint, preserving the SSH setup, files and other project links.
Ordinary environment selection then returns. Unlink before removing an associated
project environment. Sandbox start/stop/removal controls are reserved for Step 5.

### Manual check

1. Prepare two existing projects with separate folders under the mount (or clone
   Git projects through this form). Keep a local terminal open in the first project.
2. Link the first project. Expect a request to close its terminal; close it and retry.
3. Link the second project to the same sandbox and a different relative path.
4. Create a workspace for each. The environment picker should offer the sandbox;
   terminals and agents should execute over SSH. For Git workspaces, check that
   `pwd` is under the mount's `.willy-worktrees` directory.
5. Try reopening an old local terminal for either project: execution must be refused.
6. Disconnect sandbox SSH and attempt another start: expect an unavailable error,
   never a local terminal. Reconnect to continue.
7. Try unlinking the first project with its sandbox terminal open, then close that
   terminal and retry. Ordinary environment choices should return only for this
   project; the second must stay bound to the sandbox.

The Step 4 execution guard reads the sbx-provided `SANDBOX_ID` through the active
SSH relay and compares it with the UUID registered for the project. It verifies
again on a new SSH channel, so reconnecting or restarting the same sandbox does
not require unlinking its projects. A different sandbox UUID remains blocked.
The probe does not start a stopped sandbox. Older guests without `SANDBOX_ID`
retain the stricter boot-ID check and require relinking after a guest restart.

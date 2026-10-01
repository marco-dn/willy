# Willy Sandbox

Settings → Sandbox manages local Docker `sbx` shell sandboxes. Install `sbx`, complete
its login if required, and start its local daemon outside Willy. OpenSSH must be on
the host. The Linux shell template needs `sudo` without a password, `apt-get` and
`flock`. Willy does not provision sandboxes on remote SSH hosts or in the cloud.

## Choose a workflow

| Starting point | Actions | Changes made |
| --- | --- | --- |
| New sandbox | New sandbox → submit creation form | Creates the sandbox and installs the required base and selected optional tools. |
| Sandbox created outside Willy | External → expand → Manage in Willy → choose mount if needed | Saves a Willy registration only. Leaves execution state, tools, SSH and network rules unchanged. |
| Imported sandbox | Start explicitly if stopped → Verify environment | Checks identity, SSH, base tools and relay compatibility; saves the result and, on success, registers or reuses an SSH target. |
| Verified environment | Connect SSH → Projects → Link project | Establishes the execution connection, potentially deploys the relay, and performs the backend project checks. |
| Missing prerequisites | Prepare environment → review tools → Start provisioning | Explicitly configures SSH and installs the base and selected tools, with temporary network access and cleanup. |

## Sandbox list and details

Settings → Sandbox shows one catalog combining the sbx inventory with saved Willy
records by UUID. **Managed by Willy** appears first; **External** contains sandboxes
not yet registered. Each row separates observed execution state from preparation status.
Expand a row in the same list for lifecycle controls, projects and network settings; tool versions
and recent logs are expandable. Diagnostics contains service information, not another
sandbox list. A service error reports unknown state rather than removal.

**New sandbox** opens a dedicated form. Once submitted, its detail shows background
progress. **Close details** collapses the row without cancelling preparation;
completed preparation shows Configured and no active phase. Start is disabled when
already running unless an incomplete operation needs retry; Stop is disabled when
already stopped.

External sandboxes appear in the same catalog. Expand one and choose **Manage in
Willy** to import it without starting it, installing tools, configuring SSH or changing
network rules. Select the shared folder explicitly if multiple mounts are reported.
Only shell sandboxes with an existing shared directory are supported. Willy rechecks
UUID, name and mount before saving; repeat imports of the same UUID and mount reuse
the existing record. Conflicting names or identities are rejected without overwriting.

Imported sandboxes show **Verification required** and support Start, Stop and Remove.
The registration survives app restart. Project linking remains blocked in the backend
until the environment is verified. **Verify environment** requires an already running
sandbox; use **Start sandbox** first if stopped.
A Start on an imported sandbox without a registered SSH target starts the sandbox
without configuring or connecting SSH.

## Verify or prepare an imported environment

**Verify environment** reads the sandbox UUID, shared folder, SSH configuration,
base tool versions and relay compatibility. An existing preparation lock is opened
read-only: a held or unreadable lock blocks verification, and an absent lock is not
created. This preserves protection after an interrupted installer.

Verification does not run installers, modify SSH configuration or network rules,
start the sandbox, or upload a relay. Existing SSH
aliases and ProxyCommand are preserved. Missing SSH configuration is reported;
connection failures and changed identities are distinct from missing tools.

**Verification details** can be expanded and collapsed. Successful results start
collapsed; missing prerequisites and errors start expanded. The summary and actions
remain visible.

If all checks pass, Willy records or reuses the verified SSH target. **Connect SSH**
then establishes the normal Willy connection, which may install or update the relay;
actual relay startup is checked at this point. Connect before linking a project.
The backend still checks connection, identity, mount and active sessions when linking.
A failed verification never enables new project links. Existing linked projects retain
their execution restrictions.

For missing prerequisites, **Prepare environment** opens a form explaining the
mandatory base, SSH configuration and temporary network changes. Nothing is installed
until the form is submitted. Imported environments start with optional tools unchecked;
new sandboxes retain the default selections. Closing the form without submitting
makes no changes. Verification results persist across app restarts. If SSH or the
service is unavailable, resolve the reported error and verify again.

## Create a sandbox

Choose **New sandbox**, enter a name and an absolute shared folder, or use
**Choose folder**. A missing directory is created only when the checkbox explicitly
requests it. Names use 2–63 letters, digits, dots or hyphens and start with a letter
or digit. `default` is reserved. The name and shared folder remain fixed when
resuming preparation.

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
target and completes network cleanup before displaying **Tools installed**. This is provisioning
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
4. Wait for Tools installed, installed versions and the SSH host in SSH settings.
5. Import an existing stopped shell sandbox with Manage in Willy. Its ID, selected
   mount and stopped state must remain unchanged; no tools should be installed.
   Restart Willy and confirm its registration and lifecycle controls remain available.
6. On failure, read the phase/error, fix the prerequisite, then use Resume / configure.
   Restarting the app during provisioning must show Interrupted, never a false Tools installed status.

Project associations and lifecycle controls are described below. Shared files remain
accessible to other applications on the host.

## Network rules

Open **Network and credentials** on a managed sandbox. Import an external sandbox first if it is not yet managed by Willy. The editor accepts ASCII domains (or
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

## Optional GitHub API credentials

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

## Project associations

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
project environment. Lifecycle controls are described below.

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

## Start, stop and remove

Managed sandbox cards include lifecycle controls and their observed sbx state.
Refresh re-reads the daemon: an unavailable daemon is an error, never an empty
inventory or evidence that remote sessions ended.

**Start sandbox** starts the existing, identity-checked sandbox and reconnects its
SSH target. It does not create a missing replacement. **Stop sandbox** first shows
all linked projects and other registered projects using the same SSH target.
Confirmation interrupts sandbox sessions for all of them. Stop intent is saved
before disconnecting SSH; reconnect attempts are refused until an explicit Start,
including after restarting Willy. Sandboxes stopped externally must also be
started explicitly; SSH reconnect does not start them automatically.

An incomplete operation remains visible with its last error. Refresh the observed
state and retry the desired action. Closing Settings does not cancel an operation
in the main process. Restarting Willy does not automatically replay destructive
operations. Project operations and lifecycle actions cannot change the same
association concurrently; provisioning, credential prompts and lifecycle actions
also share the sandbox operation lock.

**Remove sandbox** requires all project associations to be unlinked and the sandbox
name typed into the confirmation. Willy invokes `sbx rm --force` only for the
selected sandbox, rechecking its UUID and mount before the command. Local sbx
commands address sandboxes by name, so external CLI mutations should not run
concurrently. sbx owns removal of its containers, state and managed Git worktrees;
Willy performs no filesystem deletion of shared folders. Use a disposable sandbox
for the removal check. Existing repository history and SSH targets remain because
unlinked projects or other setups may reuse them. Willy retains a small management
tombstone to prevent the old SSH target from reconnecting automatically.

If a sandbox was removed externally, Refresh reports it as missing. After unlinking
its projects, Remove can reconcile the management record without another sbx rm.
An unverified remote session can still block unlinking; losing contact does not
establish that its process exited.

Manual verification:

1. Link two projects to a running sandbox. Stop it and verify both projects appear
   in the confirmation; cancel once and confirm that nothing changed.
2. Confirm Stop. Both projects must refuse new execution; SSH reconnect must not
   restart the sandbox. Restart Willy and repeat the reconnect attempt.
3. Start the sandbox and open a terminal through its SSH environment again.
4. Verify Remove is disabled while a project is linked. Close project sessions,
   unlink both projects, then remove a disposable sandbox by typing its name.
5. Check the shared folders and files on the host and verify another sandbox and
   its SSH references remain unchanged.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| CLI missing or service unavailable | Install/login to sbx outside Willy. Run `sbx diagnose` in a host terminal; follow its daemon instructions, then Refresh. |
| Tools installed, but state says Stopped | Tool installation and execution state are separate. Use Start sandbox; Stop is disabled while already stopped. |
| SSH Connect refuses a stopped sandbox | Use Start sandbox in Sandbox settings first. Connect only establishes transport to a running sandbox. |
| Verify environment asks to start the sandbox | Use Start sandbox, then verify again. Verification never starts a stopped guest. |
| Verification reports missing SSH configuration or tools | Open Prepare environment, review the choices, then submit only if installation is wanted. Cancelling the form makes no changes. |
| Verification reports an SSH error or changed identity | Restore the correct SSH alias/connection and refresh the inventory. Retry verification; do not treat this as missing tools. |
| Local relay bundle missing | Build or reinstall Willy with the matching relay package. Guest provisioning cannot fix a missing local bundle. |
| Verification details take up space | Click Verification details to collapse the technical results. |
| A newly added sandbox API is not a function in development | Fully stop and restart the development app so its main process and preload match the renderer. |
| Project absent from the selector | Add the project to Willy first, then Refresh projects. A shared folder or diagnostic sandbox entry is not itself a project. |
| Git author identity missing | Enter name and email in the project linking form; Willy saves them in the repository. |
| Policy denies access | Check a concrete hostname and port. Add a sandbox allow rule if permitted; organization denials require an administrator. |
| Linking a project still refers to a sandbox removed by Willy | Completed removal plus a fresh sbx inventory confirming its UUID and name are absent allows the historical host to be ignored for this transition. Keep the sbx daemon available. History is retained; disconnected hosts, pending removal and replacement sandboxes still require verification. |
| Unlink reports live or unverifiable sessions | Reconnect the execution host, close that project's terminals and agents, then retry. |
| Remove unavailable after unlink | Check every project is unlinked and refresh lifecycle state. Unlink events also refresh the controls automatically. |
| Relay socket reconnect fails, followed by “Relay started successfully” | The transport recovered. Judge availability by the final connection state. |

The shared path is a host folder exposed inside the sandbox. **Project path inside
the shared folder** is relative to that mount: for mount `/work/shared` and project
`/work/shared/project-b`, enter `project-b`. This does not create a Willy project.

## Compatibility and limits

Sandbox associations and lifecycle fields are optional. Existing unbound projects
retain their ordinary environment selection. Management records written before
lifecycle controls load without a migration; interrupted network cleanup remains
attached to its original operation. The journal rejects unsupported versions or
invalid data rather than overwriting them.

Project enforcement is in the updated execution backend, including requests whose
client does not display the association. This does not make an older backend enforce
a new constraint. Do not downgrade the host managing linked projects or let an older
Willy version rewrite its data: older writers may discard fields they do not know.
No new relay stream opcode is needed. Execution of existing linked projects retains
the boot-ID fallback for older guests without `SANDBOX_ID`. The read-only import
verification requires `SANDBOX_ID` and reports the environment as unavailable if the
SSH host cannot identify itself; it does not infer identity from the alias alone.

Management runs on the desktop host; provisioning targets a Linux shell guest.
Host commands use the shared process wrappers and host path utilities. Real guest
script tests run on Linux; native macOS and Windows lifecycle flows need separate
validation. CPU/RAM configuration, UDP, arbitrary user scripts and provisioning on
remote hosts are outside this feature.

Removed sandbox names remain reserved by their management tombstones in this
version. Choose a new name when creating another sandbox. A missing sandbox with
unverifiable remote sessions may require restoring contact before unlinking; the
app does not treat disconnection as proof that those sessions exited.

## Catalog and import acceptance check

1. Keep one managed sandbox and one external shell sandbox available. Managed entries
   must appear first in a separate section. Expand and collapse details in place.
2. Import a stopped external sandbox. If it has multiple mounts, select one explicitly.
   It must move to Managed by Willy exactly once, remain stopped and show Verification
   required. Restart Willy and confirm the selected mount and registration persist.
3. Verify while stopped: an actionable start instruction must appear, with no automatic
   startup. Start explicitly and verify again. On success, collapse/expand Verification
   details, then Connect SSH and link a project without running preparation.
4. For an environment with missing prerequisites, inspect the failed checks and open
   Prepare environment. Optional tools must initially be unchecked. Cancel: no changes.
   Submit explicitly when desired and confirm progress survives closing settings.
5. If SSH or sbx is unavailable, verification must not show Configured or enable new
   project links. A service failure must show unknown state, not falsely mark all saved
   sandboxes as removed. Restore the service and refresh/verify again.
6. For an already linked project, a failed recheck must not discard its association or
   hide Unlink project. Existing execution restrictions must remain in force.

## End-to-end acceptance check

Use disposable projects and a new sandbox name. Keep another unbound project and
another sandbox available as controls. Do not enter real credentials for cancellation
checks.

1. Create a sandbox with a shared folder containing spaces and only uv selected.
   Close/reopen Settings during provisioning; progress must persist. Wait for Tools installed.
2. Add and remove a concrete network destination. Only this sandbox's editable rules
   should change. Check a denied destination and inspect the reason. Cancel the
   optional GitHub credential prompt; no configured-account claim should appear.
3. Add two projects to Willy: a GitLab repository (with Git authentication already
   configured) and a plain folder without Git. Place them in separate mount subfolders.
   Link both; a local session must block linking until closed.
4. Open workspaces for both. New execution must use the sandbox. Try an old local
   workspace and an SSH-disconnected launch: neither may fall back to the host.
   Confirm the unbound control project still works normally.
5. Restart Willy. Associations and tools must remain. Stop the sandbox after reviewing
   both affected projects; SSH Connect must not restart it, even after another app
   restart. Use Start sandbox and verify both projects can execute again.
6. Close sessions and unlink the first project. The second must remain linked and
   removal disabled. Unlink the second; removal should become available automatically.
7. Remove by typing the sandbox name. Its managed card must disappear. Inspect the
   host's shared files and the other sandbox: both must remain intact.
8. Separately interrupt provisioning on a disposable sandbox by restarting Willy.
   Expect Interrupted and explicit Resume. If temporary rule ownership is uncertain,
   follow the displayed recovery instructions instead of deleting unrelated rules.

For automated coverage and outstanding platform/UI checks, see
[Sandbox validation](willy-sandbox-validation.md).

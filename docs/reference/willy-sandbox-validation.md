# Willy Sandbox validation

Validation on Linux, 2026-10-01, following lifecycle commit `f6f0ab43fa`.
This is a record of evidence, not a claim that every acceptance scenario has run
in a packaged desktop application.

## Coverage

| Area | Automated evidence | Remaining live check |
| --- | --- | --- |
| Diagnostics | CLI parsing, errors and unavailable service; component states | Platform-specific sbx installation |
| Provisioning | Create/adopt, selected tools, explicit folder creation, concurrent requests, failure and restart recovery | Full installer matrix against current upstream downloads |
| Shared folders | Real Linux Git and Python scripts against temporary paths with spaces, two non-Git folders, escaping symlink and external Git metadata rejection | Native Windows/macOS mount mapping |
| Project identity | GitLab, GitHub, no-remote and folder projection fixtures; independent two-project associations | Authenticated live GitLab clone |
| Execution constraint | Local/SSH admission, activation race, nested projects, wrong target, old workspace rejection | Complete rendered UI/CLI/automation acceptance flow |
| Persistence | Pre-lifecycle journal loading, pending stop and cleanup journal round trip, explicit unlink surviving projection | Running an older client against the updated host |
| SSH | Stable sandbox identity, fallback, reconnect policy and unrelated hosts | Packaged builds on each supported platform |
| Network and credentials | Scoped rule changes, denial parsing, temporary rule recovery, private PTY disposal and cancellation | Organization-managed network policy and real credential prompt UI |
| Lifecycle | Stop intent, two affected projects, confirmation, shared aliases, replacement detection and external removal | Full restart cycle on Windows/macOS |
| Components | Diagnostics, provisioning and lifecycle state tests, including unlink refresh and stale response ordering | Hidden Electron renderer through Playwright CDP |

Component tests use a simulated DOM. Command/service tests use fakes except the
explicit real temporary-folder script tests. They do not establish live sbx,
network, GitLab or remote-client compatibility by themselves.

The user manually confirmed the Linux provisioning, network, project association,
SSH reconnect, unlink and lifecycle flows during implementation, including sandbox
removal. This does not substitute for an automated end-to-end run or verification
on other operating systems.

## Execution policy for checks

Run tests with `ORCA_BACKGROUND_LAUNCH=1`, one worker and no file parallelism.
Run Node, renderer and CLI typechecks sequentially. In this validation they use one
CPU with a 4 GiB V8 heap ceiling; no full parallel `pnpm tc` or full test suite is
needed. No test is allowed to show a window or steal focus.

```bash
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run \
  --config config/vitest.config.ts --maxWorkers=1 --no-file-parallelism \
  src/main/sandbox src/main/ipc/sandboxes.test.ts \
  src/renderer/src/components/settings/Sandbox
```

Additional focused regressions cover project projections, environment selectors,
Git admission, managed worktree host selection, startup ordering and SSH connection
management. Typechecking and lint findings are reported separately from test counts.

## Results

- Focused regression run before the final UI corrections: **38 files, 306 tests passed**, one worker.
- Full TypeScript checks passed sequentially for `config/tsconfig.node.json`,
  `config/tsconfig.tc.web.json` and `config/tsconfig.tc.cli.json`, each with
  `--noEmit --composite false`.
- After the final UI corrections, all 19 tests in the three Sandbox component test
  files passed; full-file oxlint, React Doctor and formatting also passed.
- Changed-lines scans passed: code quality, casting, focused plugins, React Doctor,
  design system and SAFETY comments. The type-aware oxlint scan was not run;
  the three TypeScript checks above are separate checks, not its replacement.
- Documentation file links and `git diff --check` passed.

## Outstanding rendered validation

The repository's `AGENTS.md` requires the `electron` skill and Playwright CDP for
rendered UI validation. No such skill was found in the repository, installed skill
roots, local plugin cache, or `ml-claude-skills`. No Electron application was launched
for this validation. Obtain the required skill before running the hidden-renderer
checks; do not replace them with computer-use or visible-window automation.

The user chose to perform the UI acceptance checks manually and confirmed successful
removal at the end of the flow. Two project terminals reported the same sandbox UUID
and distinct project folders beneath a shared path containing spaces. The manual pass
also led to fixes for automatic diagnostic refresh after lifecycle changes, clearer
“Tools installed” wording, prominent observed state and a disabled Stop button when
already stopped. The user confirmed the completed flow works.

Automated hidden-renderer validation remains unperformed. Live GitLab, older-client
and native Windows/macOS checks remain outstanding as listed above. Use the
[end-to-end acceptance check](willy-sandbox.md#end-to-end-acceptance-check) when
repeating the manual flow.

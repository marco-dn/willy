import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import {
  SANDBOX_TOOLS,
  type SandboxProvisionRequest,
  type ManagedSandbox,
  type SandboxTool
} from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Checkbox } from '../ui/checkbox'
import { SandboxCreationCredentials } from './SandboxCreationCredentials'

const toolNames: Record<SandboxTool, string> = {
  uv: 'uv',
  claude: 'Claude Code',
  codex: 'Codex CLI',
  databricks: 'Databricks CLI',
  'orca-skills': 'Orca skills'
}
export function SandboxProvisionForm({
  initial,
  onClose,
  onSubmitted,
  disabled = false
}: {
  initial: SandboxProvisionRequest
  onClose: () => void
  onSubmitted: (record: ManagedSandbox, configureGithub?: boolean) => void
  disabled?: boolean
}): React.JSX.Element {
  useTranslation()
  const [request, setRequest] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [github, setGithub] = useState(false)
  const [identity, setIdentity] = useState<{ name: string; email: string } | undefined>(
    initial.gitName && initial.gitEmail
      ? { name: initial.gitName, email: initial.gitEmail }
      : undefined
  )
  const create = request.mode === 'create'
  const submit = async () => {
    if (busy || disabled) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const record = await window.api.sandboxes.provision({
        ...request,
        gitName: identity?.name,
        gitEmail: identity?.email
      })
      onSubmitted(record, github)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-medium">
        {create
          ? translate('settings.sandbox.newSandbox', 'New sandbox')
          : translate('settings.sandbox.prepareEnvironment', 'Prepare environment')}
      </h3>
      <p className="text-sm text-muted-foreground">
        {translate(
          'settings.sandbox.provisionNotice',
          'Provisioning starts the sandbox and installs the selected tools. You can close settings while it runs. Deselecting a tool does not uninstall it.'
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {translate(
          'settings.sandbox.prepareSshNotice',
          'Preparation can configure SSH, install the required base and selected tools, and temporarily open network access. It starts only after you submit this form.'
        )}
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="sandbox-name">{translate('settings.sandbox.name', 'Name')}</Label>
          <Input
            id="sandbox-name"
            value={request.name}
            readOnly={!create}
            disabled={busy || disabled}
            required
            maxLength={63}
            onChange={(event) => setRequest({ ...request, name: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="sandbox-mount">
            {translate('settings.sandbox.mountPath', 'Shared folder on this computer')}
          </Label>
          <Input
            id="sandbox-mount"
            value={request.mountPath}
            readOnly={!create}
            required
            disabled={busy || disabled}
            onChange={(event) => setRequest({ ...request, mountPath: event.target.value })}
          />
          {create ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || disabled}
              onClick={() => {
                void window.api.repos
                  .pickFolder()
                  .then((path) => {
                    if (path) {
                      setRequest((current) => ({ ...current, mountPath: path }))
                    }
                  })
                  .catch((error) => setError(String(error)))
              }}
            >
              {translate('settings.sandbox.browse', 'Choose folder')}
            </Button>
          ) : null}
        </div>
        {create ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="sandbox-create-folder"
              checked={request.createMount}
              disabled={busy || disabled}
              onCheckedChange={(checked) =>
                setRequest({ ...request, createMount: checked === true })
              }
            />
            <Label htmlFor="sandbox-create-folder">
              {translate(
                'settings.sandbox.createFolder',
                'Create this folder if it does not exist'
              )}
            </Label>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.sandbox.baseTools',
            'Required base: Python, Git, curl, Node.js, npm, build tools, just and zsh.'
          )}
        </p>
        <fieldset className="space-y-2" disabled={busy || disabled}>
          <legend className="text-sm font-medium">
            {translate('settings.sandbox.optionalTools', 'Optional tools')}
          </legend>
          {SANDBOX_TOOLS.map((tool) => (
            <div key={tool} className="flex items-center gap-2">
              <Checkbox
                id={`sandbox-tool-${tool}`}
                checked={request.tools.includes(tool)}
                onCheckedChange={(checked) =>
                  setRequest((current) => ({
                    ...current,
                    tools:
                      checked === true
                        ? [...current.tools, tool]
                        : current.tools.filter((item) => item !== tool)
                  }))
                }
              />
              <Label htmlFor={`sandbox-tool-${tool}`}>
                {tool === 'orca-skills'
                  ? translate('settings.sandbox.orcaSkills', 'Orca skills')
                  : toolNames[tool]}
              </Label>
            </div>
          ))}
        </fieldset>
        <SandboxCreationCredentials
          github={github}
          onGithubChange={setGithub}
          identity={identity}
          onIdentityChange={setIdentity}
          disabled={busy || disabled}
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.sandbox.networkNotice',
            'Outbound TCP access is temporarily opened for installation, then the rule created by Willy is removed. Existing and organization policies are preserved.'
          )}
        </p>
        {error ? (
          <p role="alert" className="break-all text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {translate('settings.sandbox.backToList', 'Back to sandboxes')}
          </Button>
          <Button type="submit" disabled={busy || disabled}>
            {busy
              ? translate('settings.sandbox.starting', 'Starting…')
              : translate('settings.sandbox.provision', 'Start provisioning')}
          </Button>
        </div>
      </form>
    </section>
  )
}

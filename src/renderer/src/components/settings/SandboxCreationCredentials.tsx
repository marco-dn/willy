import { translate } from '@/i18n/i18n'
import { Checkbox } from '../ui/checkbox'
import { Input } from '../ui/input'
import { Label } from '../ui/label'

export function SandboxCreationCredentials({
  github,
  onGithubChange,
  identity,
  onIdentityChange,
  disabled
}: {
  github: boolean
  onGithubChange: (enabled: boolean) => void
  identity: { name: string; email: string } | undefined
  onIdentityChange: (identity: { name: string; email: string } | undefined) => void
  disabled: boolean
}): React.JSX.Element {
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">
        {translate('settings.sandbox.creationCredentials', 'Git and GitHub')}
      </legend>
      <div className="flex items-center gap-2">
        <Checkbox
          id="sandbox-github"
          checked={github}
          onCheckedChange={(value) => onGithubChange(value === true)}
        />
        <Label htmlFor="sandbox-github">
          {translate('settings.sandbox.setupGithub', 'GitHub token')}
        </Label>
      </div>
      {github ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'settings.sandbox.setupGithubNotice',
            'After preparation, enter your fine-grained token in the private prompt for this sandbox. Git clone/push access is configured separately.'
          )}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Checkbox
          id="sandbox-git-identity"
          checked={Boolean(identity)}
          onCheckedChange={(value) =>
            onIdentityChange(value === true ? { name: '', email: '' } : undefined)
          }
        />
        <Label htmlFor="sandbox-git-identity">
          {translate('settings.sandbox.setupGitIdentity', 'Git author identity')}
        </Label>
      </div>
      {identity ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="sandbox-git-name">
              {translate('settings.sandbox.gitName', 'Git author name')}
            </Label>
            <Input
              id="sandbox-git-name"
              required
              maxLength={256}
              value={identity.name}
              onChange={(event) => onIdentityChange({ ...identity, name: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sandbox-git-email">
              {translate('settings.sandbox.gitEmail', 'Git author email')}
            </Label>
            <Input
              id="sandbox-git-email"
              required
              maxLength={256}
              value={identity.email}
              onChange={(event) => onIdentityChange({ ...identity, email: event.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {translate(
              'settings.sandbox.setupGitIdentityNotice',
              'Used for commits in this sandbox. Repository-specific Git settings take precedence.'
            )}
          </p>
        </div>
      ) : null}
    </fieldset>
  )
}

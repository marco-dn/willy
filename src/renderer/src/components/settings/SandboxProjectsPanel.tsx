import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { Project } from '../../../../shared/project-types'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Checkbox } from '../ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

export function SandboxProjectsPanel({
  record,
  disabled
}: {
  record: ManagedSandbox
  disabled: boolean
}): React.JSX.Element {
  useTranslation()
  const id = useId()
  const mounted = useMountedRef()
  const inFlight = useRef(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string>()
  const [projectId, setProjectId] = useState('')
  const [relativePath, setRelativePath] = useState('.')
  const [clone, setClone] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [gitName, setGitName] = useState('')
  const [gitEmail, setGitEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [unlinkingProjectId, setUnlinkingProjectId] = useState<string>()
  const selected = projects.find((project) => project.id === projectId)
  const availableProjects = projects.filter((project) => !project.sandboxBinding)
  const refresh = useCallback(async () => {
    try {
      const next = await window.api.projects.list()
      if (mounted.current) {
        setProjects(next)
        setLoadError(undefined)
        setProjectId((current) =>
          next.some((project) => project.id === current && !project.sandboxBinding) ? current : ''
        )
      }
    } catch (error) {
      if (mounted.current) {
        setLoadError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (mounted.current) {
        setLoading(false)
      }
    }
  }, [mounted])
  useEffect(() => {
    const update = () => {
      void refresh()
    }
    update()
    return window.api.repos.onChanged(update)
  }, [refresh])
  const perform = async (operation: () => Promise<void>) => {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    setBusy(true)
    setError(undefined)
    try {
      await operation()
      await refresh()
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {translate(
          'settings.sandbox.projectNotice',
          'Linked projects run only in this sandbox. Close project sessions on other environments before linking. Shared files remain accessible to other applications on this computer.'
        )}
      </p>
      {error && !unlinkingProjectId ? (
        <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {projects
        .filter((project) => project.sandboxBinding?.sandboxId === record.sandboxId)
        .map((project) => (
          <div key={project.id} className="space-y-2 rounded-md border border-border p-3">
            <p className="text-sm font-medium">{project.displayName}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">
              {project.sandboxBinding?.projectPath}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                if (inFlight.current) {
                  return
                }
                setUnlinkingProjectId(project.id)
                void perform(() => window.api.sandboxes.unlinkProject(project.id))
              }}
            >
              {busy && unlinkingProjectId === project.id
                ? translate('settings.sandbox.linkingProject', 'Updating project association…')
                : translate('settings.sandbox.unlinkProject', 'Unlink project')}
            </Button>
            {unlinkingProjectId === project.id && error ? (
              <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        ))}
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (disabled || !record.sandboxId) {
            return
          }
          setUnlinkingProjectId(undefined)
          const target = { name: record.name, id: record.sandboxId }
          void perform(() =>
            window.api.sandboxes.linkProject({
              target,
              projectId,
              relativePath,
              ...(clone ? { cloneUrl } : {}),
              ...(gitName.trim() ? { gitName } : {}),
              ...(gitEmail.trim() ? { gitEmail } : {})
            })
          )
        }}
      >
        <div className="space-y-2">
          <Label>{translate('settings.sandbox.project', 'Project')}</Label>
          <Select
            value={projectId}
            disabled={
              disabled || busy || loading || Boolean(loadError) || availableProjects.length === 0
            }
            onValueChange={(value) => {
              setProjectId(value)
              setClone(false)
            }}
          >
            <SelectTrigger aria-label={translate('settings.sandbox.project', 'Project')}>
              <SelectValue
                placeholder={translate(
                  'settings.sandbox.selectProject',
                  'Select an existing project'
                )}
              />
            </SelectTrigger>
            <SelectContent position="popper" align="start">
              {availableProjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {loading ? (
            <p role="status" className="text-sm text-muted-foreground">
              {translate('settings.sandbox.loadingProjects', 'Loading projects…')}
            </p>
          ) : loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : availableProjects.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {projects.length === 0
                ? translate(
                    'settings.sandbox.noProjects',
                    'No projects have been added to Willy. Close Settings, add a repository or folder as a project, then return here.'
                  )
                : translate(
                    'settings.sandbox.noAvailableProjects',
                    'All projects are already linked to a sandbox. Unlink a project before choosing another sandbox.'
                  )}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || loading}
            onClick={() => {
              setLoading(true)
              void refresh()
            }}
          >
            {translate('settings.sandbox.refreshProjects', 'Refresh projects')}
          </Button>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-path`}>
            {translate(
              'settings.sandbox.projectRelativePath',
              'Project path inside the shared folder'
            )}
          </Label>
          <Input
            id={`${id}-path`}
            value={relativePath}
            disabled={disabled || busy}
            required
            onChange={(event) => setRelativePath(event.target.value)}
          />
        </div>
        <p className="break-all font-mono text-xs text-muted-foreground">{record.mountPath}</p>
        {selected && selected.kind !== 'folder' ? (
          <>
            <Label>
              <Checkbox
                checked={clone}
                disabled={disabled || busy}
                onCheckedChange={(value) => setClone(value === true)}
              />
              {translate('settings.sandbox.cloneProject', 'Clone into a new folder via SSH')}
            </Label>
            {clone ? (
              <div className="space-y-2">
                <Label htmlFor={`${id}-url`}>
                  {' '}
                  {translate('settings.sandbox.cloneUrl', 'Repository URL')}{' '}
                </Label>
                <Input
                  id={`${id}-url`}
                  value={cloneUrl}
                  required
                  disabled={disabled || busy}
                  onChange={(event) => setCloneUrl(event.target.value)}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>
                {' '}
                {translate('settings.sandbox.gitName', 'Git author name')}{' '}
              </Label>
              <Input
                id={`${id}-name`}
                value={gitName}
                disabled={disabled || busy}
                onChange={(event) => setGitName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-email`}>
                {' '}
                {translate('settings.sandbox.gitEmail', 'Git author email')}{' '}
              </Label>
              <Input
                id={`${id}-email`}
                value={gitEmail}
                disabled={disabled || busy}
                onChange={(event) => setGitEmail(event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {translate(
                'settings.sandbox.gitIdentityNotice',
                'Leave blank to use the identity already available inside the sandbox. The chosen identity is saved only for this repository.'
              )}
            </p>
          </>
        ) : null}
        <Button
          type="submit"
          disabled={
            disabled ||
            busy ||
            loading ||
            Boolean(loadError) ||
            !selected ||
            Boolean(selected.sandboxBinding)
          }
        >
          {busy
            ? translate('settings.sandbox.linkingProject', 'Updating project association…')
            : translate('settings.sandbox.linkProject', 'Link project')}
        </Button>
      </form>
    </section>
  )
}

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { SandboxTarget } from '../../../../shared/sandbox-policy-types'
import type {
  SandboxLifecycleAction,
  SandboxLifecycleSnapshot
} from '../../../../shared/sandbox-lifecycle-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'

export function SandboxLifecyclePanel({
  target,
  disabled
}: {
  target: SandboxTarget
  disabled: boolean
}): React.JSX.Element {
  useTranslation()
  const mounted = useMountedRef()
  const id = useId()
  const active = useRef(false)
  const refreshSequence = useRef(0)
  const [snapshot, setSnapshot] = useState<SandboxLifecycleSnapshot>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState<'stop' | 'remove'>()
  const [confirmName, setConfirmName] = useState('')
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current
    try {
      const next = await window.api.sandboxes.lifecycleSnapshot({
        name: target.name,
        id: target.id
      })
      if (mounted.current && sequence === refreshSequence.current) {
        setSnapshot(next)
      }
      return next
    } catch (error) {
      if (mounted.current && sequence === refreshSequence.current) {
        setSnapshot(undefined)
      }
      throw error
    }
  }, [target.id, target.name, mounted])
  const perform = async (operation: () => Promise<void>) => {
    if (active.current) {
      return
    }
    active.current = true
    setBusy(true)
    setError(undefined)
    try {
      await operation()
    } catch (error) {
      if (mounted.current) {
        setError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      active.current = false
      if (mounted.current) {
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    const update = () => {
      void refresh().catch((error: unknown) => {
        if (mounted.current) {
          setError(error instanceof Error ? error.message : String(error))
        }
      })
    }
    update()
    return window.api.repos.onChanged(update)
  }, [refresh, mounted])
  const execute = async (action: SandboxLifecycleAction) => {
    await window.api.sandboxes.lifecycle({
      target,
      action,
      ...(action !== 'start'
        ? { confirmedProjectIds: snapshot?.projects.map((project) => project.id) ?? [] }
        : {}),
      ...(action === 'remove' ? { confirmName } : {})
    })
    if (mounted.current) {
      setConfirmation(undefined)
    }
    await refresh()
  }
  const linked = snapshot?.projects.some((project) => project.linked)
  return (
    <section className="space-y-3">
      <p className="text-sm font-medium">
        {translate('settings.sandbox.lifecycleTitle', 'Start, stop and remove')}
      </p>
      {snapshot ? (
        <p role="status" className="text-sm text-muted-foreground">
          {snapshot.state === 'running'
            ? translate('settings.sandbox.stateRunning', 'Running')
            : snapshot.state === 'stopped'
              ? translate('settings.sandbox.stateStopped', 'Stopped')
              : snapshot.state === 'missing'
                ? translate('settings.sandbox.stateMissing', 'Removed outside Willy')
                : translate('settings.sandbox.stateUnavailable', 'State unavailable')}
        </p>
      ) : null}
      {snapshot?.lifecycle?.pending ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'settings.sandbox.lifecyclePending',
            'The last operation is not confirmed. Refresh the observed state and retry the action if needed.'
          )}
        </p>
      ) : null}
      {snapshot?.lifecycle?.error ? (
        <p className="text-sm text-destructive">{snapshot.lifecycle.error}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              await refresh()
            })
          }
        >
          {translate('settings.sandbox.refresh', 'Refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={
            disabled ||
            busy ||
            !snapshot ||
            snapshot.state === 'missing' ||
            snapshot.state === 'unavailable'
          }
          onClick={() => void perform(() => execute('start'))}
        >
          {translate('settings.sandbox.startSandbox', 'Start sandbox')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || busy || !snapshot || snapshot.state === 'missing'}
          onClick={() =>
            void perform(async () => {
              await refresh()
              setConfirmName('')
              setConfirmation('stop')
            })
          }
        >
          {translate('settings.sandbox.stopSandbox', 'Stop sandbox')}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          disabled={disabled || busy || !snapshot || linked}
          onClick={() =>
            void perform(async () => {
              await refresh()
              setConfirmName('')
              setConfirmation('remove')
            })
          }
        >
          {translate('settings.sandbox.removeSandbox', 'Remove sandbox')}
        </Button>
      </div>
      {linked ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'settings.sandbox.unlinkBeforeRemove',
            'Unlink all projects before removing this sandbox.'
          )}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('settings.sandbox.lifecycleBusy', 'Updating sandbox…')}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirmation(undefined)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation === 'stop'
                ? translate('settings.sandbox.stopSandbox', 'Stop sandbox')
                : translate('settings.sandbox.removeSandbox', 'Remove sandbox')}
            </DialogTitle>
            <DialogDescription>
              {confirmation === 'stop'
                ? translate(
                    'settings.sandbox.stopNotice',
                    'This stops the sandbox and interrupts its sessions. All projects using this SSH environment are affected. Automatic reconnection stays blocked until you start it again.'
                  )
                : translate(
                    'settings.sandbox.removeNotice',
                    'This removes the sandbox through sbx. Willy does not delete shared folders. SSH targets and project history are preserved because they may be reused.'
                  )}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm font-medium">{target.name}</p>
          <p className="text-sm">
            {translate('settings.sandbox.affectedProjects', 'Affected projects')}
          </p>
          {snapshot?.projects.length ? (
            <ul className="space-y-1 text-sm">
              {snapshot.projects.map((project) => (
                <li key={project.id}>{project.name}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate(
                'settings.sandbox.noAffectedProjects',
                'No registered projects use this sandbox.'
              )}
            </p>
          )}
          {confirmation === 'remove' ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>
                {translate(
                  'settings.sandbox.confirmSandboxName',
                  'Type the sandbox name to confirm'
                )}
              </Label>
              <Input
                id={`${id}-name`}
                value={confirmName}
                disabled={busy}
                onChange={(event) => setConfirmName(event.target.value)}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmation(undefined)}>
              {translate('settings.sandbox.cancelLifecycle', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={
                busy || (confirmation === 'remove' && (confirmName !== target.name || linked))
              }
              onClick={() => {
                if (confirmation) {
                  void perform(() => execute(confirmation))
                }
              }}
            >
              {busy
                ? translate('settings.sandbox.lifecycleBusy', 'Updating sandbox…')
                : translate('settings.sandbox.confirmLifecycle', 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

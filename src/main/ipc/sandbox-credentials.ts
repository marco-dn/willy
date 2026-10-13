import { ipcMain, type WebContents } from 'electron'
import { SandboxCredentialSessions } from '../sandbox/sandbox-credential-session'
import type { SandboxAccess } from '../sandbox/sandbox-command'
import type { CredentialOwner } from '../sandbox/sandbox-credential-session'

function credentialOwner(sender: WebContents): CredentialOwner {
  return {
    id: sender.id,
    send: (event) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('sandboxes:credential-event', event)
        }
      } catch {
        /* A closing renderer cannot receive private terminal events. */
      }
    },
    onDispose: (callback) => {
      sender.on('destroyed', callback)
      sender.on('render-process-gone', callback)
      sender.on('did-start-navigation', callback)
      return () => {
        sender.removeListener('destroyed', callback)
        sender.removeListener('render-process-gone', callback)
        sender.removeListener('did-start-navigation', callback)
      }
    }
  }
}
let sessions: SandboxCredentialSessions | undefined
export function registerSandboxCredentialHandlers(
  acquire: (target: unknown) => Promise<SandboxAccess>
): void {
  sessions ??= new SandboxCredentialSessions({
    acquire,
    spawn: async (name, cols, rows) =>
      (await import('../sandbox/sandbox-credential-pty')).spawnSandboxCredentialPty(
        name,
        cols,
        rows
      )
  })
  for (const name of [
    'credential-start',
    'credential-input',
    'credential-resize',
    'credential-close'
  ]) {
    ipcMain.removeHandler(`sandboxes:${name}`)
  }
  ipcMain.handle('sandboxes:credential-start', (event, request: unknown) =>
    sessions!.start(credentialOwner(event.sender), request)
  )
  ipcMain.handle('sandboxes:credential-input', (event, request: unknown) => {
    try {
      sessions!.write(event.sender.id, request)
    } catch {
      throw new Error('Private credential input is unavailable.')
    }
  })
  ipcMain.handle('sandboxes:credential-resize', (event, request: unknown) =>
    sessions!.resize(event.sender.id, request)
  )
  ipcMain.handle('sandboxes:credential-close', (event, sessionId: unknown) => {
    if (typeof sessionId === 'string') {
      sessions!.close(event.sender.id, sessionId)
    }
  })
}

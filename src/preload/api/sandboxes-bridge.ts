import type { SandboxCredentialEvent } from '../../shared/sandbox-policy-types'
import { ipcRenderer } from 'electron'
import type { SandboxesApi } from '../../shared/sandbox-types'

export const sandboxesApi = {
  linkProject: (request) => ipcRenderer.invoke('sandboxes:linkProject', request),
  unlinkProject: (projectId) => ipcRenderer.invoke('sandboxes:unlinkProject', projectId),
  policy: (request) => ipcRenderer.invoke('sandboxes:policy', request),
  startCredentials: (request) => ipcRenderer.invoke('sandboxes:credential-start', request),
  writeCredentials: (request) => ipcRenderer.invoke('sandboxes:credential-input', request),
  resizeCredentials: (request) => ipcRenderer.invoke('sandboxes:credential-resize', request),
  closeCredentials: (sessionId) => ipcRenderer.invoke('sandboxes:credential-close', sessionId),
  onCredentialEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, event: SandboxCredentialEvent) =>
      listener(event)
    ipcRenderer.on('sandboxes:credential-event', handler)
    return () => ipcRenderer.removeListener('sandboxes:credential-event', handler)
  },
  inspect: () => ipcRenderer.invoke('sandboxes:inspect'),
  listManaged: () => ipcRenderer.invoke('sandboxes:listManaged'),
  provision: (request) => ipcRenderer.invoke('sandboxes:provision', request)
} satisfies SandboxesApi

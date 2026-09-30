import { ipcRenderer } from 'electron'
import type { SandboxesApi } from '../../shared/sandbox-types'

export const sandboxesApi = {
  inspect: () => ipcRenderer.invoke('sandboxes:inspect'),
  listManaged: () => ipcRenderer.invoke('sandboxes:listManaged'),
  provision: (request) => ipcRenderer.invoke('sandboxes:provision', request)
} satisfies SandboxesApi

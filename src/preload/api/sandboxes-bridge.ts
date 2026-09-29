import { ipcRenderer } from 'electron'
import type { SandboxesApi } from '../../shared/sandbox-types'

export const sandboxesApi = {
  inspect: () => ipcRenderer.invoke('sandboxes:inspect')
} satisfies SandboxesApi

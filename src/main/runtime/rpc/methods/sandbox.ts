import { defineMethod } from '../core'
import {
  SandboxRuntimeProject,
  SandboxRuntimePath,
  SandboxRuntimeProjectSelector
} from '../../../../shared/sandbox-runtime-contract'

export const SANDBOX_RUNTIME_METHODS = [
  defineMethod({
    name: 'sandbox.verifyPath',
    permission: 'workspace',
    params: SandboxRuntimePath,
    handler: async (params) => {
      const { verifySandboxHostIdentity } = await import('../../../sandbox/sandbox-host-identity')
      await verifySandboxHostIdentity(params, [params.path])
      return { verified: true }
    }
  }),
  defineMethod({
    name: 'sandbox.registerProject',
    permission: 'host-admin',
    params: SandboxRuntimeProject,
    handler: (params, { runtime }) =>
      runtime.registerSandboxProject(params, () =>
        runtime.addRepo(params.projectPath, params.kind, 'local', params.displayName)
      )
  }),
  defineMethod({
    name: 'sandbox.unlinkProject',
    permission: 'host-admin',
    params: SandboxRuntimeProjectSelector,
    handler: (params, { runtime }) => runtime.unlinkSandboxProject(params.projectId)
  }),
  defineMethod({
    name: 'sandbox.projectIdle',
    permission: 'workspace',
    params: SandboxRuntimeProjectSelector,
    handler: (params, { runtime }) => runtime.assertSandboxProjectIdle(params.projectId)
  })
]

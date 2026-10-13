import type { SandboxProvisionStage } from '../../../../shared/sandbox-provisioning-types'
import { translate } from '@/i18n/i18n'
import type { SandboxInspectionError } from '../../../../shared/sandbox-types'

export function sandboxErrorCopy(reason: SandboxInspectionError): string {
  switch (reason) {
    case 'cli-missing':
      return translate(
        'settings.sandbox.cliMissing',
        'sbx was not found. Install Docker Sandboxes, make sbx available on PATH, then restart Willy.'
      )
    case 'service-unavailable':
      return translate(
        'settings.sandbox.serviceUnavailable',
        'The local sbx service is unavailable. Run sbx diagnose in a host terminal, then refresh.'
      )
    case 'timeout':
      return translate(
        'settings.sandbox.timeout',
        'sbx did not respond in time. Run sbx diagnose in a host terminal, then refresh.'
      )
    case 'invalid-response':
      return translate(
        'settings.sandbox.invalidResponse',
        'sbx returned an unsupported or incomplete response. Check your Docker Sandboxes installation, then refresh.'
      )
    case 'command-failed':
      return translate(
        'settings.sandbox.commandFailed',
        'The sbx check failed. Run sbx diagnose in a host terminal; if authentication is required, run sbx login. Then refresh.'
      )
  }
}

export function sandboxStatusCopy(status: string): string {
  switch (status) {
    case 'running':
      return translate('settings.sandbox.running', 'Running')
    case 'stopped':
      return translate('settings.sandbox.stopped', 'Stopped')
    default:
      return translate('settings.sandbox.observedStatus', 'Reported state: {{state}}', {
        state: status
      })
  }
}

export function sandboxPhaseCopy(stage: SandboxProvisionStage): string {
  switch (stage) {
    case 'sandbox':
      return translate('settings.sandbox.phaseSandbox', 'Create / validate sandbox')
    case 'ssh':
      return translate('settings.sandbox.phaseSsh', 'Configure SSH')
    case 'network':
      return translate('settings.sandbox.phaseNetwork', 'Temporary network access')
    case 'base':
      return translate('settings.sandbox.phaseBase', 'Install required base')
    case 'verify':
      return translate('settings.sandbox.phaseVerify', 'Verify installed tools')
    case 'connect':
      return translate('settings.sandbox.phaseConnect', 'Connect SSH host')
    case 'cleanup':
      return translate('settings.sandbox.phaseCleanup', 'Restore network rules')
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex CLI'
    case 'databricks':
      return 'Databricks CLI'
    case 'uv':
      return 'uv'
    case 'orca-skills':
      return translate('settings.sandbox.orcaSkills', 'Orca skills')
  }
}

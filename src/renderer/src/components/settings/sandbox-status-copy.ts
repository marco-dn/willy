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

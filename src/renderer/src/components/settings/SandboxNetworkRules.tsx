import { translate } from '@/i18n/i18n'
import type { SandboxNetworkRule } from '../../../../shared/sandbox-policy-types'
import { Button } from '../ui/button'

export function SandboxNetworkRules({
  rules,
  disabled,
  onRemove
}: {
  rules: SandboxNetworkRule[]
  disabled: boolean
  onRemove: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="space-y-4">
      {[true, false].map((editable) => (
        <section key={String(editable)} className="space-y-2">
          <details open={editable} className="space-y-2">
            <summary className="cursor-pointer text-sm font-medium">
              <span>
                {editable
                  ? translate('settings.sandbox.localRules', 'Sandbox TCP allow rules')
                  : translate(
                      'settings.sandbox.inheritedRules',
                      'Inherited and other read-only policies'
                    )}
              </span>{' '}
              ({rules.filter((rule) => rule.editable === editable).length})
            </summary>
            {rules.filter((rule) => rule.editable === editable).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {translate('settings.sandbox.noRules', 'No rules in this group.')}
              </p>
            ) : (
              <ul className="space-y-2">
                {rules
                  .filter((rule) => rule.editable === editable)
                  .map((rule) => (
                    <li
                      key={`${rule.scope}:${rule.id}`}
                      className="space-y-1 rounded-md border border-border p-3"
                    >
                      <p className="break-all font-mono text-xs">{rule.resources.join(', ')}</p>
                      <p className="break-all text-xs text-muted-foreground">
                        {rule.decision} · {rule.scope} · {rule.layer} · {rule.actions.join(', ')}
                      </p>
                      {editable ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disabled}
                          onClick={() => onRemove(rule.id)}
                        >
                          {translate('settings.sandbox.removeRule', 'Remove rule')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
          </details>
        </section>
      ))}
    </div>
  )
}

import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translateSearchKeyword } from './settings-search-keywords'

export const getSandboxPaneSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('settings.sandbox.title', 'Sandbox'),
    description: translate(
      'settings.sandbox.description',
      'Create, provision and inspect Docker Sandboxes on this computer.'
    ),
    keywords: [
      'sbx',
      'Docker',
      'sandbox',
      ...translateSearchKeyword('settings.sandbox.create', 'Create sandbox'),
      ...translateSearchKeyword('settings.sandbox.provisioning', 'Provisioning'),
      ...translateSearchKeyword('settings.sandbox.diagnostics', 'Diagnostics'),
      ...translateSearchKeyword('settings.sandbox.mounts', 'Shared folders')
    ]
  }
])

import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import type { ManagedSandbox } from '../../src/shared/sandbox-provisioning-types'
import type { SandboxInspection } from '../../src/shared/sandbox-types'
import { test, expect } from './helpers/orca-app'
import { waitForSessionReady } from './helpers/store'

async function seedSandboxes(app: ElectronApplication, unavailable = false): Promise<void> {
  const record: ManagedSandbox = {
    name: 'z-managed',
    sandboxId: 'managed-id',
    mountPath: '/work/test sandbox',
    operationId: 'import-test',
    status: 'imported',
    stage: 'sandbox',
    tools: [],
    logs: [],
    versions: [],
    updatedAt: 1
  }
  const inspection: SandboxInspection = {
    cliPath: '/fixture/sbx',
    clientVersion: 'fixture',
    serverVersion: 'fixture',
    serverState: 'running',
    ...(unavailable
      ? {
          status: 'error' as const,
          reason: 'service-unavailable' as const,
          detail: 'Fixture daemon unavailable'
        }
      : {
          status: 'ready' as const,
          sandboxes: [
            {
              id: 'external-id',
              name: 'a-external',
              agent: 'shell',
              status: 'stopped',
              workspaces: ['/work/external']
            },
            {
              id: 'managed-id',
              name: record.name,
              agent: 'shell',
              status: 'stopped',
              workspaces: [record.mountPath]
            }
          ]
        })
  }
  await app.evaluate(
    ({ ipcMain }, { record, inspection }) => {
      const records = [record]
      let state = 'stopped'
      const replace = (channel: string, handler: (...args: unknown[]) => unknown) => {
        ipcMain.removeHandler(channel)
        ipcMain.handle(channel, handler)
      }
      replace('sandboxes:inspect', () => inspection)
      replace('sandboxes:listManaged', () => records)
      replace('sandboxes:lifecycleSnapshot', () => ({ state, projects: [] }))
      replace('sandboxes:lifecycle', (_event, request) => {
        if (
          typeof request !== 'object' ||
          request === null ||
          !('action' in request) ||
          request.action !== 'start'
        ) {
          throw new Error('Only fixture startup is allowed')
        }
        state = 'running'
      })
      replace('sandboxes:import', () => {
        const imported = {
          ...record,
          name: 'a-external',
          sandboxId: 'external-id',
          mountPath: '/work/external'
        }
        records.push(imported)
        return imported
      })
      replace('sandboxes:verifyEnvironment', () => ({
        checkedAt: Date.now(),
        outcome: 'ready',
        canPrepare: false,
        checks: [
          { id: 'ssh', status: 'ok', detail: 'Fixture SSH check completed without installation' }
        ]
      }))
      // Unexpected actions must not reach the host's real sandbox service.
      for (const channel of [
        'provision',
        'policy',
        'linkProject',
        'unlinkProject',
        'credential-start'
      ]) {
        replace(`sandboxes:${channel}`, () => {
          throw new Error(`Unexpected sandbox action: ${channel}`)
        })
      }
    },
    { record, inspection }
  )
}

async function openSandboxSettings(page: Page): Promise<void> {
  await waitForSessionReady(page)
  await page.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Missing E2E store')
    }
    await store.getState().updateSettings({ uiLanguage: 'en' })
    store.getState().openSettingsPage()
  })
  await page.getByPlaceholder('Search settings').fill('sandbox')
  await expect(page.getByRole('heading', { name: 'Sandbox', exact: true })).toBeVisible()
}

test('sandbox catalog groups, inline details and separate creation form', async ({
  electronApp,
  orcaPage
}) => {
  await seedSandboxes(electronApp)
  await openSandboxSettings(orcaPage)
  const groups = orcaPage.getByRole('region').filter({ has: orcaPage.getByRole('list') })
  await expect(groups.nth(0)).toHaveAccessibleName('Managed by Willy')
  await expect(groups.nth(1)).toHaveAccessibleName('External')
  await expect(orcaPage.getByText('z-managed', { exact: true })).toHaveCount(1)
  await orcaPage.getByRole('button', { name: 'Open z-managed', exact: true }).click()
  await expect(orcaPage.getByRole('button', { name: 'Stop sandbox', exact: true })).toBeDisabled()
  await expect(orcaPage.getByRole('button', { name: 'Start sandbox', exact: true })).toBeEnabled()
  await expect(orcaPage.getByText('a-external', { exact: true })).toBeVisible()
  await orcaPage.getByRole('button', { name: 'Close z-managed details' }).click()
  await expect(orcaPage.getByRole('button', { name: 'Stop sandbox', exact: true })).toHaveCount(0)
  await orcaPage.getByRole('button', { name: 'New sandbox', exact: true }).click()
  await expect(orcaPage.getByLabel('Name', { exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('region', { name: 'Managed by Willy' })).toHaveCount(0)
  await orcaPage.getByRole('button', { name: 'Back to sandboxes' }).click()
  await expect(orcaPage.getByText('z-managed', { exact: true })).toBeVisible()
})

test('external import crosses preload IPC and verification details can collapse', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await seedSandboxes(electronApp)
  await openSandboxSettings(orcaPage)
  await orcaPage.getByRole('button', { name: 'Open a-external', exact: true }).click()
  await orcaPage.getByRole('button', { name: 'Manage in Willy', exact: true }).click()
  await expect(orcaPage.getByRole('region', { name: 'External', exact: true })).toHaveCount(0)
  await expect(orcaPage.getByText('a-external', { exact: true })).toHaveCount(1)
  await expect(orcaPage.getByRole('button', { name: 'Stop sandbox', exact: true })).toBeDisabled()
  await orcaPage.getByRole('button', { name: 'Start sandbox', exact: true }).click()
  await expect(orcaPage.getByRole('button', { name: 'Start sandbox', exact: true })).toBeDisabled()
  await expect(orcaPage.getByRole('button', { name: 'Stop sandbox', exact: true })).toBeEnabled()
  await orcaPage.getByRole('button', { name: 'Verify environment', exact: true }).click()
  const check = orcaPage.getByText('Fixture SSH check completed without installation', {
    exact: true
  })
  await expect(orcaPage.getByText(/Prerequisites verified/)).toBeVisible()
  await expect(check).not.toBeVisible()
  await orcaPage.getByText('Verification details', { exact: true }).click()
  await expect(check).toBeVisible()
  await orcaPage.getByText('Verification details', { exact: true }).click()
  await expect(check).not.toBeVisible()
  await testInfo.attach('sandbox-import-verified', {
    body: await orcaPage.screenshot(),
    contentType: 'image/png'
  })
})

test('unavailable service retains managed records without a false empty inventory', async ({
  electronApp,
  orcaPage
}) => {
  await seedSandboxes(electronApp, true)
  await openSandboxSettings(orcaPage)
  await expect(orcaPage.getByText('Fixture daemon unavailable')).toBeVisible()
  await expect(orcaPage.getByText('z-managed', { exact: true })).toBeVisible()
  await expect(orcaPage.getByText('No local sandboxes found.', { exact: true })).toHaveCount(0)
  await expect(orcaPage.getByText('Removed outside Willy', { exact: true })).toHaveCount(0)
  await expect(orcaPage.getByRole('button', { name: 'New sandbox', exact: true })).toBeDisabled()
  await orcaPage.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(orcaPage.getByText('Fixture daemon unavailable')).toBeVisible()
})

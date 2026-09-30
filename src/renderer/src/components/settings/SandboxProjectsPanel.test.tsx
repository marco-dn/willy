// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../../../shared/project-types'
import type { ManagedSandbox } from '../../../../shared/sandbox-provisioning-types'
import { SandboxProjectsPanel } from './SandboxProjectsPanel'
const record: ManagedSandbox = {
  name: 'demo',
  sandboxId: 'sandbox',
  mountPath: '/shared',
  tools: [],
  operationId: 'op',
  status: 'ready',
  stage: 'cleanup',
  updatedAt: 1,
  logs: [],
  versions: []
}
const project: Project = {
  id: 'p',
  displayName: 'My project',
  badgeColor: 'blue',
  kind: 'folder',
  sourceRepoIds: ['local'],
  createdAt: 1,
  updatedAt: 1
}
const list = vi.fn()
const linkProject = vi.fn()
const unlinkProject = vi.fn()
beforeEach(() => {
  list.mockReset().mockResolvedValue([project])
  linkProject.mockReset().mockResolvedValue(undefined)
  unlinkProject.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('api', {
    projects: { list },
    repos: { onChanged: () => () => {} },
    sandboxes: { linkProject, unlinkProject }
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
describe('sandbox project controls', () => {
  it('requires project selection and shows the shared folder', async () => {
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    await waitFor(() => expect(list).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Link project' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('/shared')).toBeTruthy()
    expect(screen.queryByText('Git author name')).toBeNull()
  })
  it('shows only this sandbox associations and unlinks only the selected project', async () => {
    const binding = {
      sandboxId: 'sandbox',
      sandboxName: 'demo',
      sshTargetId: 'ssh',
      setupId: 'remote',
      repoId: 'remote',
      mountPath: '/shared',
      projectPath: '/shared/project'
    }
    list.mockResolvedValue([
      { ...project, sandboxBinding: binding },
      {
        ...project,
        id: 'other',
        displayName: 'Other project',
        sandboxBinding: { ...binding, sandboxId: 'other-sandbox' }
      }
    ])
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    const unlink = await screen.findByRole('button', { name: 'Unlink project' })
    expect(screen.queryByText('Other project')).toBeNull()
    fireEvent.click(unlink)
    await waitFor(() => expect(unlinkProject).toHaveBeenCalledWith('p'))
  })
  it('keeps an association visible when active sessions prevent unlinking', async () => {
    list.mockResolvedValue([
      {
        ...project,
        sandboxBinding: {
          sandboxId: 'sandbox',
          sandboxName: 'demo',
          sshTargetId: 'ssh',
          setupId: 'remote',
          repoId: 'remote',
          mountPath: '/shared',
          projectPath: '/shared/project'
        }
      }
    ])
    unlinkProject.mockRejectedValueOnce(new Error('Close project terminals'))
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlink project' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Close project terminals')
    expect(screen.getByText('My project')).toBeTruthy()
  })
  it('opens the menu and links the chosen project', async () => {
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    const trigger = screen.getByRole('combobox', { name: 'Project' })
    await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false))
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'My project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Link project' }))
    await waitFor(() =>
      expect(linkProject).toHaveBeenCalledWith({
        target: { name: 'demo', id: 'sandbox' },
        projectId: 'p',
        relativePath: '.'
      })
    )
  })
  it('explains an empty catalog and reloads projects', async () => {
    list.mockResolvedValueOnce([])
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('No projects have been added')
    )
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh projects' }))
    await waitFor(() => expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false))
  })
  it('shows catalog errors instead of an empty menu and allows retry', async () => {
    list.mockRejectedValueOnce(new Error('Catalog unavailable'))
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    expect((await screen.findByRole('alert')).textContent).toBe('Catalog unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh projects' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false)
  })
  it('shows unlink progress and removes only the unlinked project after refresh', async () => {
    const binding = {
      sandboxId: 'sandbox',
      sandboxName: 'demo',
      sshTargetId: 'ssh',
      setupId: 'setup',
      repoId: 'repo',
      mountPath: '/shared',
      projectPath: '/shared/project'
    }
    const second = { ...project, id: 'second', displayName: 'Second', sandboxBinding: binding }
    list
      .mockResolvedValueOnce([{ ...project, sandboxBinding: binding }, second])
      .mockResolvedValue([{ ...project, sandboxBinding: null }, second])
    const pending = Promise.withResolvers<void>()
    unlinkProject.mockReturnValueOnce(pending.promise)
    render(<SandboxProjectsPanel record={record} disabled={false} />)
    const buttons = await screen.findAllByRole('button', { name: 'Unlink project' })
    fireEvent.click(buttons[0])
    expect(
      screen.getAllByRole('button', { name: 'Updating project association…' }).length
    ).toBeGreaterThan(0)
    expect(buttons[0].hasAttribute('disabled')).toBe(true)
    pending.resolve()
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Unlink project' })).toHaveLength(1)
    )
    expect(screen.getByText('Second')).toBeTruthy()
    expect(unlinkProject).toHaveBeenCalledWith('p')
  })
})

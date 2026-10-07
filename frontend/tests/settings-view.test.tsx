import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsView } from '@/settings/SettingsView'
import { createSettingsClient, SETUP_TOKEN_HEADER, type SettingsClient } from '@/settings/settings-client'
import { ApiError } from '@/lib/api-client'
import type { FolderListing, RootsCheck, RootsSettings } from '@shared/settings-types'

/**
 * The roots picker — Settings view and install page alike.
 *
 * The client is faked; what is under test is that the view asks the server for
 * every verdict rather than deciding one itself, and that each post-save path
 * (restart, manual, installer) tells the operator what actually happens next.
 */
const HOME = '/Users/me'
const FOLDERS: Record<string, FolderListing> = {
  [HOME]: {
    path: HOME,
    parent: null,
    folders: [
      { name: 'Documents', path: `${HOME}/Documents`, markdown: null, capped: false, protected: true },
      { name: 'ops', path: `${HOME}/ops`, markdown: 10, capped: false, protected: false },
      { name: 'src', path: `${HOME}/src`, markdown: 1000, capped: true, protected: false },
    ],
  },
  [`${HOME}/src`]: {
    path: `${HOME}/src`,
    parent: HOME,
    folders: [
      { name: 'eg', path: `${HOME}/src/eg`, markdown: 412, capped: false, protected: false },
      { name: 'personal', path: `${HOME}/src/personal`, markdown: 86, capped: false, protected: false },
    ],
  },
}

function fakeClient(overrides: Partial<SettingsClient> = {}, settings: Partial<RootsSettings> = {}) {
  const base: RootsSettings = {
    roots: [`${HOME}/ops`],
    saved: [`${HOME}/ops`],
    editable: true,
    reason: null,
    home: HOME,
    afterSave: 'manual',
    ...settings,
  }
  const client = {
    getRoots: vi.fn(async () => base),
    listFolders: vi.fn(async (p?: string) => FOLDERS[p ?? HOME] ?? { path: p!, parent: HOME, folders: [] }),
    check: vi.fn(async (roots: string[]): Promise<RootsCheck> => ({ ok: true, roots })),
    save: vi.fn(async (roots: string[]) => ({ roots, afterSave: base.afterSave })),
    ...overrides,
  }
  return client
}

const fast = { checkDelayMs: 0, pollIntervalMs: 1, pollTimeoutMs: 200 }

async function renderPicker(client: SettingsClient, variant: 'app' | 'install' = 'app') {
  render(<SettingsView client={client} variant={variant} pickerOptions={fast} />)
  await screen.findByRole('checkbox', { name: `Use ${HOME}/ops as a root` })
}

describe('SettingsView — choosing', () => {
  it('lists home folders with counts and flags privacy-protected ones', async () => {
    await renderPicker(fakeClient())
    const tree = screen.getByTestId('folder-tree')
    expect(within(tree).getByText('1,000+ md')).toBeInTheDocument()
    expect(within(tree).getByText('10 md')).toBeInTheDocument()
    expect(within(tree).getByText('Full Disk Access')).toBeInTheDocument()
  })

  it('starts from the current roots, checked', async () => {
    await renderPicker(fakeClient())
    expect(screen.getByRole('checkbox', { name: `Use ${HOME}/ops as a root` })).toBeChecked()
    expect(screen.getByRole('button', { name: /save roots/i })).toBeDisabled()
  })

  it('opens a folder to choose nested ones, asks the server, then saves the selection', async () => {
    const client = fakeClient()
    const user = userEvent.setup()
    await renderPicker(client)

    await user.click(screen.getByRole('button', { name: 'Expand src' }))
    await user.click(await screen.findByRole('checkbox', { name: `Use ${HOME}/src/eg as a root` }))
    await user.click(screen.getByRole('checkbox', { name: `Use ${HOME}/src/personal as a root` }))

    // Appended in click order: order decides which root keeps a shared name.
    await waitFor(() => expect(client.check).toHaveBeenLastCalledWith([`${HOME}/ops`, `${HOME}/src/eg`, `${HOME}/src/personal`]))
    expect(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` })).toHaveAttribute('data-state', 'indeterminate')
    expect(within(screen.getByRole('region', { name: 'Chosen roots' })).getByText('~/src/eg')).toBeInTheDocument()

    const save = screen.getByRole('button', { name: /save roots/i })
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    expect(client.save).toHaveBeenCalledWith([`${HOME}/ops`, `${HOME}/src/eg`, `${HOME}/src/personal`])
    expect(await screen.findByText(/restart vibedocs to serve them/i)).toBeInTheDocument()
  })

  it('labels the folders inside a chosen root as its projects', async () => {
    const user = userEvent.setup()
    await renderPicker(fakeClient({}, { roots: [`${HOME}/src`], saved: [`${HOME}/src`] }))
    await user.click(screen.getByRole('button', { name: 'Expand src' }))
    await screen.findByRole('checkbox', { name: `Use ${HOME}/src/eg as a root` })
    expect(screen.getAllByText('project')).toHaveLength(2)
  })

  it('shows the server\'s refusal and will not save', async () => {
    const client = fakeClient({
      check: vi.fn(async (): Promise<RootsCheck> => ({ ok: false, error: `Root ${HOME}/src/eg is nested inside root ${HOME}/src.` })),
    })
    const user = userEvent.setup()
    await renderPicker(client)
    await user.click(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` }))
    await user.click(screen.getByRole('button', { name: 'Expand src' }))
    await user.click(await screen.findByRole('checkbox', { name: `Use ${HOME}/src/eg as a root` }))
    expect(await screen.findByText(/is nested inside root/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save roots/i })).toBeDisabled()
  })

  it('removes a root from the chosen list', async () => {
    const user = userEvent.setup()
    await renderPicker(fakeClient())
    await user.click(screen.getByRole('button', { name: `Remove ${HOME}/ops` }))
    expect(screen.getByRole('checkbox', { name: `Use ${HOME}/ops as a root` })).not.toBeChecked()
    expect(screen.getByText('None chosen.')).toBeInTheDocument()
  })
})

describe('SettingsView — what a save means', () => {
  it('waits for the supervised restart to come back on the new roots', async () => {
    let calls = 0
    const target = [`${HOME}/ops`, `${HOME}/src`]
    const client = fakeClient({}, { afterSave: 'restart' })
    client.getRoots = vi.fn(async () => {
      calls++
      if (calls === 1) return { roots: [`${HOME}/ops`], saved: [`${HOME}/ops`], editable: true, reason: null, home: HOME, afterSave: 'restart' as const }
      // The old process answers once more before it exits, then the server is down.
      if (calls === 2) return { roots: [`${HOME}/ops`], saved: target, editable: true, reason: null, home: HOME, afterSave: 'restart' as const }
      if (calls === 3) throw new TypeError('fetch failed')
      return { roots: target, saved: target, editable: true, reason: null, home: HOME, afterSave: 'restart' as const }
    })
    const user = userEvent.setup()
    await renderPicker(client)
    await user.click(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` }))
    await waitFor(() => expect(screen.getByRole('button', { name: /save roots/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /save roots/i }))
    expect(await screen.findByText('VibeDocs is serving the new roots.')).toBeInTheDocument()
    expect(calls).toBeGreaterThanOrEqual(4)
  })

  it('says so when the restart never comes back', async () => {
    const client = fakeClient({}, { afterSave: 'restart' })
    const user = userEvent.setup()
    await renderPicker(client)
    client.getRoots = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await user.click(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` }))
    await waitFor(() => expect(screen.getByRole('button', { name: /save roots/i })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /save roots/i }))
    expect(await screen.findByText(/has not come back/)).toBeInTheDocument()
  })

  it('on the install page, hands back to the installer and locks the picker', async () => {
    const client = fakeClient({}, { afterSave: 'done' })
    const user = userEvent.setup()
    await renderPicker(client, 'install')
    expect(screen.getByRole('heading', { name: 'Choose folders for VibeDocs' })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Use these folders' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Use these folders' }))
    expect(await screen.findByText(/installer is carrying on in your terminal/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: `Use ${HOME}/ops as a root` })).toBeDisabled()
  })

  it('on the install page, lets the current roots be kept as they are', async () => {
    // Re-running the installer to keep the same folders must not dead-end on a
    // disabled button.
    const client = fakeClient({}, { afterSave: 'done' })
    const user = userEvent.setup()
    await renderPicker(client, 'install')
    const use = screen.getByRole('button', { name: 'Use these folders' })
    await waitFor(() => expect(use).toBeEnabled())
    await user.click(use)
    expect(client.save).toHaveBeenCalledWith([`${HOME}/ops`])
  })

  it('flags a saved selection that the running server has not applied yet', async () => {
    await renderPicker(fakeClient({}, { roots: [`${HOME}/ops`], saved: [`${HOME}/src`] }))
    expect(screen.getByText(/not running yet/)).toBeInTheDocument()
    // The selection starts from the file, which is what the next boot will use.
    expect(screen.getByRole('checkbox', { name: `Use ${HOME}/src as a root` })).toBeChecked()
  })
})

describe('SettingsView — when roots cannot be changed here', () => {
  it('shows the reason and the roots, with no tree', async () => {
    render(
      <SettingsView
        client={fakeClient({}, { editable: false, saved: null, reason: 'Roots come from VIBEDOCS_ROOTS.' })}
        pickerOptions={fast}
      />,
    )
    expect(await screen.findByText('Roots come from VIBEDOCS_ROOTS.')).toBeInTheDocument()
    expect(screen.getByText('~/ops')).toBeInTheDocument()
    expect(screen.queryByTestId('folder-tree')).not.toBeInTheDocument()
  })

  it('explains a 404 as the feature being off', async () => {
    const client = fakeClient({ getRoots: vi.fn(async () => Promise.reject(new ApiError('Not found', 404))) })
    render(<SettingsView client={client} pickerOptions={fast} />)
    expect(await screen.findByText(/VIBEDOCS_SETTINGS_ENABLED/)).toBeInTheDocument()
  })
})

describe('createSettingsClient', () => {
  it('sends the install page token on every request', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: { ok: true, roots: [] } }), { status: 200 }))
    const client = createSettingsClient({ fetch: fetchSpy as unknown as typeof fetch, setupToken: 'tok' })
    await client.check(['/a'])
    await client.listFolders('/a b')
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)[SETUP_TOKEN_HEADER]).toBe('tok')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect((fetchSpy.mock.calls[1] as unknown as [string])[0]).toBe('/api/settings/folders?path=%2Fa%20b')
  })

  it('raises the server\'s error message with its status', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ error: 'nested' }), { status: 400 }))
    const client = createSettingsClient({ fetch: fetchSpy as unknown as typeof fetch })
    await expect(client.save(['/a'])).rejects.toMatchObject({ message: 'nested', status: 400 })
  })
})

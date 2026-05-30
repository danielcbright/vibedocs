import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BreadcrumbNav } from '@/components/breadcrumb-nav'
import type { FileNode } from '@/hooks/use-projects'

const PROJECT_TREE: FileNode[] = [
  { name: 'README.md', path: 'README.md', type: 'file' },
  { name: 'CHANGELOG.md', path: 'CHANGELOG.md', type: 'file' },
  {
    name: 'docs',
    path: 'docs',
    type: 'folder',
    children: [{ name: 'install.md', path: 'docs/install.md', type: 'file' }],
  },
]

describe('BreadcrumbNav — project segment dropdown', () => {
  it('renders the project segment as a DirectoryDropdown trigger even at a single-segment docPath', () => {
    // Single-segment path: argus/README.md → parts === ['README.md']
    // The bug was that parts.length === 1 caused the project segment to
    // render as inert <BreadcrumbPage> text instead of a navigable dropdown,
    // stranding the user with no way to browse sibling root-level files.
    render(
      <BreadcrumbNav
        project="argus"
        docPath="README.md"
        tree={PROJECT_TREE}
        onNavigate={() => {}}
      />,
    )
    // A Radix DropdownMenuTrigger is a <button> with aria-haspopup="menu".
    // Querying by accessible name 'argus' should resolve to that trigger.
    const trigger = screen.getByRole('button', { name: /argus/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('opening the project dropdown lists root-level siblings and routes picks through onNavigate', async () => {
    const onNavigate = vi.fn()
    render(
      <BreadcrumbNav
        project="argus"
        docPath="README.md"
        tree={PROJECT_TREE}
        onNavigate={onNavigate}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /argus/i }))
    // Picking CHANGELOG.md should fire onNavigate with the sibling root path.
    await userEvent.click(await screen.findByRole('menuitem', { name: /CHANGELOG\.md/ }))
    expect(onNavigate).toHaveBeenCalledWith('argus', 'CHANGELOG.md')
  })
})

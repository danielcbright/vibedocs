import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectPicker, countMarkdownDocs } from '@/components/project-picker'
import type { FileNode, ProjectInfo } from '@/hooks/use-projects'

const FIXTURE_PROJECTS: ProjectInfo[] = [
  {
    name: 'argus',
    hasDocsFolder: true,
    tree: [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'docs', path: 'docs', type: 'folder', children: [
        { name: 'install.md', path: 'docs/install.md', type: 'file' },
      ] },
    ],
  },
  {
    name: 'vibedocs',
    hasDocsFolder: false,
    tree: [
      { name: 'README.md', path: 'README.md', type: 'file' },
    ],
  },
  {
    name: 'empty-project',
    hasDocsFolder: false,
    tree: [],
  },
]

describe('countMarkdownDocs', () => {
  it('returns 0 for an empty tree', () => {
    const tree: FileNode[] = []
    expect(countMarkdownDocs(tree)).toBe(0)
  })

  it('counts top-level .md and .markdown files, excluding assets and non-markdown', () => {
    const tree: FileNode[] = [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'NOTES.markdown', path: 'NOTES.markdown', type: 'file' },
      { name: 'logo.png', path: 'logo.png', type: 'file', isAsset: true },
      { name: 'config.json', path: 'config.json', type: 'file', isAsset: true },
      // Markdown extension on an asset (defensive — shouldn't happen, but if
      // it did, isAsset should still win)
      { name: 'fake.md', path: 'fake.md', type: 'file', isAsset: true },
    ]
    expect(countMarkdownDocs(tree)).toBe(2)
  })

  it('recurses into folders to count nested markdown files', () => {
    const tree: FileNode[] = [
      { name: 'README.md', path: 'README.md', type: 'file' },
      {
        name: 'docs',
        path: 'docs',
        type: 'folder',
        children: [
          { name: 'install.md', path: 'docs/install.md', type: 'file' },
          { name: 'screenshot.png', path: 'docs/screenshot.png', type: 'file', isAsset: true },
          {
            name: 'guides',
            path: 'docs/guides',
            type: 'folder',
            children: [
              { name: 'a.md', path: 'docs/guides/a.md', type: 'file' },
              { name: 'b.markdown', path: 'docs/guides/b.markdown', type: 'file' },
            ],
          },
        ],
      },
    ]
    expect(countMarkdownDocs(tree)).toBe(4)
  })
})

describe('ProjectPicker', () => {
  it('renders one card per project, with project name as the card title', () => {
    render(<ProjectPicker projects={FIXTURE_PROJECTS} onNavigate={() => {}} />)
    const cards = screen.getAllByTestId('project-picker-card')
    expect(cards).toHaveLength(3)
    expect(screen.getByText('argus')).toBeInTheDocument()
    expect(screen.getByText('vibedocs')).toBeInTheDocument()
    expect(screen.getByText('empty-project')).toBeInTheDocument()
  })

  it('clicking a card calls onNavigate(project.name, "") — the empty path lets navigateSmart resolve to the first markdown file', async () => {
    const onNavigate = vi.fn()
    render(<ProjectPicker projects={FIXTURE_PROJECTS} onNavigate={onNavigate} />)
    const cards = screen.getAllByTestId('project-picker-card')
    await userEvent.click(cards[1]) // vibedocs
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('vibedocs', '')
  })
})

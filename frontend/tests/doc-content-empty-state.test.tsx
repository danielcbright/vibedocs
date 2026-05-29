import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@/components/theme-provider'
import { DocContent } from '@/components/doc-content'
import type { ProjectInfo } from '@/hooks/use-projects'

const FIXTURE_PROJECTS: ProjectInfo[] = [
  {
    name: 'demo',
    hasDocsFolder: true,
    tree: [
      { name: 'README.md', path: 'README.md', type: 'file' },
    ],
  },
  {
    name: 'vibedocs',
    hasDocsFolder: false,
    tree: [
      { name: 'README.md', path: 'README.md', type: 'file' },
      { name: 'docs', path: 'docs', type: 'folder', children: [
        { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
      ] },
    ],
  },
]

function renderEmptyState(props: Partial<React.ComponentProps<typeof DocContent>> = {}) {
  const defaults: React.ComponentProps<typeof DocContent> = {
    html: '',
    loading: false,
    error: null,
    project: null,
    docPath: null,
    connected: true,
    projects: FIXTURE_PROJECTS,
  }
  return render(
    <ThemeProvider>
      <DocContent {...defaults} {...props} />
    </ThemeProvider>,
  )
}

describe('DocContent empty-state branch', () => {
  it('renders the ProjectPicker (cards) instead of the legacy welcome text when project is null', () => {
    renderEmptyState()
    expect(screen.queryByText('Welcome to VibeDocs')).not.toBeInTheDocument()
    const cards = screen.getAllByTestId('project-picker-card')
    expect(cards).toHaveLength(2)
    expect(screen.getByText('demo')).toBeInTheDocument()
    expect(screen.getByText('vibedocs')).toBeInTheDocument()
  })

  it('clicking a picker card calls the onNavigate prop with empty path', async () => {
    const onNavigate = vi.fn()
    renderEmptyState({ onNavigate })
    const cards = screen.getAllByTestId('project-picker-card')
    await userEvent.click(cards[0])
    expect(onNavigate).toHaveBeenCalledWith('demo', '')
  })

  it('does not render the mobileSearchTrigger button — the picker IS the primary affordance now', () => {
    renderEmptyState({ mobileSearchTrigger: vi.fn() })
    expect(screen.queryByTestId('welcome-search-button')).not.toBeInTheDocument()
  })
})

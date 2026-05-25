import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/app-sidebar'
import type { ProjectInfo } from '@/hooks/use-projects'

function renderSidebar(props: Partial<React.ComponentProps<typeof AppSidebar>> = {}) {
  const defaults: React.ComponentProps<typeof AppSidebar> = {
    projects: [],
    activeProject: null,
    activePath: null,
    onNavigate: () => {},
    viewMode: 'docs',
    onViewModeChange: () => {},
  }
  return render(
    <TooltipProvider>
      <AppSidebar {...defaults} {...props} />
    </TooltipProvider>,
  )
}

const FILE_TREE_PROJECT: ProjectInfo = {
  name: 'demo',
  hasDocsFolder: true,
  tree: [
    { name: 'README.md', path: 'README.md', type: 'file' },
    {
      name: 'docs',
      path: 'docs',
      type: 'folder',
      children: [{ name: 'install.md', path: 'docs/install.md', type: 'file' }],
    },
  ],
}

describe('AppSidebar — file-tree mode (no siteConfig)', () => {
  it('renders the discovered file tree and the filter input when the active project has no siteConfig', () => {
    renderSidebar({
      projects: [FILE_TREE_PROJECT],
      activeProject: 'demo',
    })

    expect(screen.getByPlaceholderText('Filter files...')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('docs')).toBeInTheDocument()
  })
})

const SITE_NAV_PROJECT: ProjectInfo = {
  name: 'demo',
  hasDocsFolder: true,
  tree: [
    // Tree still includes README; site-nav mode should ignore it.
    { name: 'README.md', path: 'README.md', type: 'file' },
  ],
  siteConfig: {
    name: 'demo',
    domain: 'example.io',
    description: 'observability',
    theme: { tokens: {} },
    llms: { summary: 's', keyDocs: [] },
    nav: {
      sections: [
        {
          label: 'Getting Started',
          items: ['docs/install.md', 'docs/quickstart.md'],
        },
        {
          label: 'Guides',
          items: ['docs/guides/observability.md'],
        },
      ],
    },
  },
}

describe('AppSidebar — site-nav mode (siteConfig.nav present)', () => {
  it('renders the curated section labels in declared order', () => {
    renderSidebar({
      projects: [SITE_NAV_PROJECT],
      activeProject: 'demo',
    })

    const sections = screen.getAllByTestId('site-nav-section-label')
    expect(sections.map((el) => el.textContent)).toEqual(['Getting Started', 'Guides'])
  })

  it('renders each item as an anchor whose href points at the project hash URL, in declared order', () => {
    renderSidebar({
      projects: [SITE_NAV_PROJECT],
      activeProject: 'demo',
    })

    const links = screen.getAllByTestId('site-nav-link') as HTMLAnchorElement[]
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '#demo/docs/install.md',
      '#demo/docs/quickstart.md',
      '#demo/docs/guides/observability.md',
    ])
  })

  it('invokes onNavigate(project, item) when a curated link is clicked', async () => {
    const onNavigate = vi.fn()
    renderSidebar({
      projects: [SITE_NAV_PROJECT],
      activeProject: 'demo',
      onNavigate,
    })

    const links = screen.getAllByTestId('site-nav-link')
    await userEvent.click(links[1]) // docs/quickstart.md

    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('demo', 'docs/quickstart.md')
  })

  it('marks the link matching activePath as active (data-active="true")', () => {
    renderSidebar({
      projects: [SITE_NAV_PROJECT],
      activeProject: 'demo',
      activePath: 'docs/quickstart.md',
    })

    const links = screen.getAllByTestId('site-nav-link')
    expect(links[0]).not.toHaveAttribute('data-active', 'true')
    expect(links[1]).toHaveAttribute('data-active', 'true')
    expect(links[2]).not.toHaveAttribute('data-active', 'true')
  })

  it('hides the file-tree filter input when the active project is in site-nav mode', () => {
    renderSidebar({
      projects: [SITE_NAV_PROJECT],
      activeProject: 'demo',
    })

    expect(screen.queryByPlaceholderText('Filter files...')).not.toBeInTheDocument()
  })

  it('falls back to file-tree mode when siteConfig is present but omits nav', () => {
    // Cast to bypass the strict shape — production loaders validate the
    // full SiteConfig, but the rendering branch only inspects `siteConfig.nav`,
    // so partial fixtures keep this test focused on the branch under test.
    const projectWithoutNav: ProjectInfo = {
      ...SITE_NAV_PROJECT,
      siteConfig: { /* nav intentionally omitted */ } as ProjectInfo['siteConfig'],
    }
    renderSidebar({
      projects: [projectWithoutNav],
      activeProject: 'demo',
    })

    // Curated sections must NOT render; filter input + file tree must.
    expect(screen.queryByTestId('site-nav-section-label')).not.toBeInTheDocument()
    expect(screen.getByPlaceholderText('Filter files...')).toBeInTheDocument()
    expect(screen.getByText('README.md')).toBeInTheDocument()
  })
})

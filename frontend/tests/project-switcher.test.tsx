import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isStaticBuild } from '@/lib/is-static'
import { ProjectSwitcher } from '@/components/project-switcher'
import type { ProjectInfo } from '@/hooks/use-projects'

const FIXTURE_PROJECTS: ProjectInfo[] = [
  { name: 'demo', hasDocsFolder: true, tree: [] },
  { name: 'vibedocs', hasDocsFolder: false, tree: [] },
  { name: 'alpha-docs', hasDocsFolder: false, tree: [] },
]

afterEach(() => {
  delete (window as { __VIBEDOCS_STATIC?: boolean }).__VIBEDOCS_STATIC
})

describe('isStaticBuild', () => {
  it('returns false in the live app (flag absent)', () => {
    expect(isStaticBuild()).toBe(false)
  })

  it('returns true only when window.__VIBEDOCS_STATIC === true', () => {
    ;(window as { __VIBEDOCS_STATIC?: boolean }).__VIBEDOCS_STATIC = true
    expect(isStaticBuild()).toBe(true)
  })

  it('treats any non-true value (e.g. truthy strings) as live', () => {
    ;(window as unknown as { __VIBEDOCS_STATIC?: unknown }).__VIBEDOCS_STATIC =
      'yes'
    expect(isStaticBuild()).toBe(false)
  })
})

describe('ProjectSwitcher — visibility gating', () => {
  it('renders nothing in static-build mode', () => {
    ;(window as { __VIBEDOCS_STATIC?: boolean }).__VIBEDOCS_STATIC = true
    const { container } = render(
      <ProjectSwitcher
        projects={FIXTURE_PROJECTS}
        activeProject="demo"
        onNavigate={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when there are no projects', () => {
    const { container } = render(
      <ProjectSwitcher projects={[]} activeProject={null} onNavigate={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the trigger in live mode with projects present', () => {
    render(
      <ProjectSwitcher
        projects={FIXTURE_PROJECTS}
        activeProject="demo"
        onNavigate={() => {}}
      />,
    )
    expect(
      screen.getByRole('button', { name: /switch project/i }),
    ).toBeInTheDocument()
  })
})

describe('ProjectSwitcher — dropdown behavior', () => {
  it('lists every project once the menu is opened', async () => {
    render(
      <ProjectSwitcher
        projects={FIXTURE_PROJECTS}
        activeProject="demo"
        onNavigate={() => {}}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /switch project/i }),
    )
    const items = await screen.findAllByRole('menuitem')
    expect(items).toHaveLength(3)
    expect(screen.getByRole('menuitem', { name: /demo/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /vibedocs/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /alpha-docs/ })).toBeInTheDocument()
  })

  it('marks the active project with aria-current', async () => {
    render(
      <ProjectSwitcher
        projects={FIXTURE_PROJECTS}
        activeProject="vibedocs"
        onNavigate={() => {}}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /switch project/i }),
    )
    const active = await screen.findByRole('menuitem', { name: /vibedocs/ })
    expect(active).toHaveAttribute('aria-current', 'true')
    const inactive = screen.getByRole('menuitem', { name: /demo/ })
    expect(inactive).not.toHaveAttribute('aria-current', 'true')
  })

  it('picking a project calls onNavigate(name, "") so navigateSmart resolves the first doc', async () => {
    const onNavigate = vi.fn()
    render(
      <ProjectSwitcher
        projects={FIXTURE_PROJECTS}
        activeProject="demo"
        onNavigate={onNavigate}
      />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /switch project/i }),
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /alpha-docs/ }),
    )
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('alpha-docs', '')
  })
})

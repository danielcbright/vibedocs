import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PanelToggle } from '@/components/panel-toggle'

function renderToggle(props: Partial<React.ComponentProps<typeof PanelToggle>> = {}) {
  const onToggle = vi.fn()
  render(
    <TooltipProvider>
      <PanelToggle side="left" label="sidebar" collapsed={false} onToggle={onToggle} {...props} />
    </TooltipProvider>,
  )
  return { onToggle }
}

describe('PanelToggle', () => {
  it('labels the action, not the state: open panel offers Hide', () => {
    renderToggle({ collapsed: false })
    const btn = screen.getByTestId('panel-toggle-left')
    expect(btn).toHaveAttribute('aria-label', 'Hide sidebar')
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  it('collapsed panel offers Show', () => {
    renderToggle({ collapsed: true, side: 'right', label: 'table of contents' })
    const btn = screen.getByTestId('panel-toggle-right')
    expect(btn).toHaveAttribute('aria-label', 'Show table of contents')
    expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicking calls onToggle once', () => {
    const { onToggle } = renderToggle()
    fireEvent.click(screen.getByTestId('panel-toggle-left'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

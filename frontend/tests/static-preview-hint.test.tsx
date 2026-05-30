import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaticPreviewHint } from '@/components/static-preview-hint'

describe('StaticPreviewHint', () => {
  it('renders nothing when project is null', () => {
    const { container } = render(<StaticPreviewHint project={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a trigger button labelled "Preview as static site" when a project is provided', () => {
    render(<StaticPreviewHint project="argus" />)
    expect(
      screen.getByRole('button', { name: /preview as static site/i }),
    ).toBeInTheDocument()
  })
})

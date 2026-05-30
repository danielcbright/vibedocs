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

  it('opening the popover reveals a CLI command containing the selected project name', async () => {
    render(<StaticPreviewHint project="argus" />)
    await userEvent.click(
      screen.getByRole('button', { name: /preview as static site/i }),
    )
    // The exact command string is the contract — readers will copy-paste it
    // verbatim into a shell, so the test pins the format.
    expect(
      await screen.findByText(
        /npx vibedocs build --project argus --serve --port 9001/,
      ),
    ).toBeInTheDocument()
  })
})

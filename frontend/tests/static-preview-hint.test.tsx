import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaticPreviewHint } from '@/components/static-preview-hint'

describe('StaticPreviewHint', () => {
  beforeEach(() => {
    // jsdom doesn't expose a real navigator.clipboard; mock writeText so each
    // test starts from a clean spy.
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })


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

  it('clicking "Copy command" writes the full CLI command to the clipboard', async () => {
    render(<StaticPreviewHint project="argus" />)
    await userEvent.click(
      screen.getByRole('button', { name: /preview as static site/i }),
    )
    const copyBtn = await screen.findByRole('button', { name: /copy command/i })
    await userEvent.click(copyBtn)
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'npx vibedocs build --project argus --serve --port 9001',
    )
  })
})

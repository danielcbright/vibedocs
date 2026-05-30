import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StaticPreviewHint } from '@/components/static-preview-hint'

describe('StaticPreviewHint', () => {
  it('renders nothing when project is null', () => {
    const { container } = render(<StaticPreviewHint project={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

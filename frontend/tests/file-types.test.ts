import { describe, it, expect } from 'vitest'
import { isImageFile, isMarkdownFile, IMAGE_EXTENSIONS } from '@/lib/file-types'

describe('isImageFile', () => {
  it('recognizes common raster + vector image extensions case-insensitively', () => {
    expect(isImageFile('photo.png')).toBe(true)
    expect(isImageFile('PHOTO.PNG')).toBe(true)
    expect(isImageFile('logo.SVG')).toBe(true)
    expect(isImageFile('anim.gif')).toBe(true)
    expect(isImageFile('pic.jpeg')).toBe(true)
    expect(isImageFile('pic.jpg')).toBe(true)
    expect(isImageFile('shot.webp')).toBe(true)
  })

  it('returns false for non-image files', () => {
    expect(isImageFile('README.md')).toBe(false)
    expect(isImageFile('notes.txt')).toBe(false)
    expect(isImageFile('doc.pdf')).toBe(false)
  })

  it('returns false for an extensionless name (no false positive on the whole string)', () => {
    expect(isImageFile('LICENSE')).toBe(false)
    expect(isImageFile('png')).toBe(false)
  })

  it('exposes the canonical extension set with a leading dot', () => {
    expect(IMAGE_EXTENSIONS.has('.png')).toBe(true)
    expect(IMAGE_EXTENSIONS.has('png')).toBe(false)
  })
})

describe('isMarkdownFile', () => {
  it('recognizes .md and .markdown case-insensitively', () => {
    expect(isMarkdownFile('README.md')).toBe(true)
    expect(isMarkdownFile('README.MD')).toBe(true)
    expect(isMarkdownFile('guide.markdown')).toBe(true)
    expect(isMarkdownFile('guide.MARKDOWN')).toBe(true)
  })

  it('returns false for non-markdown files', () => {
    expect(isMarkdownFile('photo.png')).toBe(false)
    expect(isMarkdownFile('notes.txt')).toBe(false)
    expect(isMarkdownFile('readme')).toBe(false)
  })
})

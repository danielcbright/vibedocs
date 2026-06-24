/**
 * Shared file-type predicates for the file tree. Kept dependency-free and
 * pure so they're unit-testable in isolation and reusable across the sidebar
 * components (file-icon picking, filter logic) without dragging React in.
 */

export const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
])

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  if (dot === -1) return ""
  return name.slice(dot).toLowerCase()
}

export function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(name))
}

export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name))
}

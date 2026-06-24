import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

function readManifest() {
  return JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf-8'))
}

describe('PWA manifest', () => {
  it('declares the installability essentials', () => {
    const m = readManifest()
    expect(m.name).toBe('VibeDocs')
    expect(m.short_name).toBeTruthy()
    expect(m.short_name.length).toBeLessThanOrEqual(12) // home-screen label budget
    expect(m.display).toBe('standalone')
    expect(m.start_url).toBe('/')
    expect(m.scope).toBe('/')
  })

  it('sets theme + background colors as hex', () => {
    const m = readManifest()
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('ships 192, 512, and a maskable icon, and every referenced file exists', () => {
    const m = readManifest()
    const sizes = m.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')

    const hasMaskable = m.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'))
    expect(hasMaskable).toBe(true)

    for (const icon of m.icons as Array<{ src: string }>) {
      const file = path.join(publicDir, icon.src.replace(/^\//, ''))
      expect(existsSync(file), `missing icon file: ${icon.src}`).toBe(true)
    }
  })

  it('ships an apple-touch-icon and favicon for the <head> links', () => {
    expect(existsSync(path.join(publicDir, 'apple-touch-icon.png'))).toBe(true)
    expect(existsSync(path.join(publicDir, 'favicon.svg'))).toBe(true)
    expect(existsSync(path.join(publicDir, 'favicon.ico'))).toBe(true)
  })
})

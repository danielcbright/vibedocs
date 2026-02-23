import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-discovery-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

import { buildTreePublic } from '../src/discovery.js'

describe('buildTree with non-markdown files', () => {
  it('includes image files in the tree', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const docsDir = path.join(projectRoot, 'docs')
    await mkdir(docsDir, { recursive: true })
    await writeFile(path.join(docsDir, 'guide.md'), '# Guide')
    await writeFile(path.join(docsDir, 'screenshot.png'), 'fake-png')

    const tree = await buildTreePublic(docsDir, projectRoot)
    const names = tree.map(n => n.name).sort()
    expect(names).toEqual(['guide.md', 'screenshot.png'])
  })

  it('marks non-markdown files with isAsset flag', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const docsDir = path.join(projectRoot, 'docs')
    await mkdir(docsDir, { recursive: true })
    await writeFile(path.join(docsDir, 'notes.md'), '# Notes')
    await writeFile(path.join(docsDir, 'photo.jpg'), 'fake-jpg')

    const tree = await buildTreePublic(docsDir, projectRoot)
    const md = tree.find(n => n.name === 'notes.md')!
    const img = tree.find(n => n.name === 'photo.jpg')!
    expect(md.isAsset).toBeFalsy()
    expect(img.isAsset).toBe(true)
  })

  it('still includes folders with mixed content', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const imagesDir = path.join(projectRoot, 'docs', 'images')
    await mkdir(imagesDir, { recursive: true })
    await writeFile(path.join(imagesDir, 'logo.svg'), '<svg/>')

    const tree = await buildTreePublic(path.join(projectRoot, 'docs'), projectRoot)
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('images')
    expect(tree[0].type).toBe('folder')
    expect(tree[0].children).toHaveLength(1)
    expect(tree[0].children![0].name).toBe('logo.svg')
    expect(tree[0].children![0].isAsset).toBe(true)
  })

  it('still skips empty files', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const docsDir = path.join(projectRoot, 'docs')
    await mkdir(docsDir, { recursive: true })
    await writeFile(path.join(docsDir, 'empty.txt'), '')
    await writeFile(path.join(docsDir, 'notempty.txt'), 'content')

    const tree = await buildTreePublic(docsDir, projectRoot)
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('notempty.txt')
  })
})

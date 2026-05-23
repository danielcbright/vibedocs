import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, mkdtemp } from 'fs/promises'
import path from 'path'
import os from 'os'
import { resolveUploadDir, safeWriteFile } from '../src/upload.js'
import { VibedocsError } from '../src/errors.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-test-'))
  // Create a project structure: tmpDir/myproject/docs/
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('resolveUploadDir', () => {
  it('resolves a valid folder path within a project', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', 'docs')
    expect(result).toBe(path.join(tmpDir, 'myproject', 'docs'))
  })

  it('resolves project root when folder path is empty', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', '')
    expect(result).toBe(path.join(tmpDir, 'myproject'))
  })

  it('throws VibedocsError(traversal) on .. path', () => {
    expect(() => resolveUploadDir(tmpDir, 'myproject', '../otherproject'))
      .toThrowError(VibedocsError)
    try {
      resolveUploadDir(tmpDir, 'myproject', '../otherproject')
    } catch (err) {
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })

  it('throws VibedocsError(traversal) on .. in project name', () => {
    try {
      resolveUploadDir(tmpDir, '../etc', 'docs')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })

  it('throws VibedocsError(traversal) on absolute paths in folder', () => {
    try {
      resolveUploadDir(tmpDir, 'myproject', '/etc/passwd')
      throw new Error('expected throw')
    } catch (err) {
      expect(err).toBeInstanceOf(VibedocsError)
      expect((err as VibedocsError).code).toBe('traversal')
    }
  })
})

describe('safeWriteFile', () => {
  it('writes a file to the target directory', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    const result = await safeWriteFile(targetDir, 'test.md', Buffer.from('# Hello'))
    expect(result.savedName).toBe('test.md')
    const content = await readFile(path.join(targetDir, 'test.md'), 'utf-8')
    expect(content).toBe('# Hello')
  })

  it('renames on conflict with extension', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'readme.md'), 'existing')
    const result = await safeWriteFile(targetDir, 'readme.md', Buffer.from('new'))
    expect(result.savedName).toBe('readme-1.md')
    const content = await readFile(path.join(targetDir, 'readme-1.md'), 'utf-8')
    expect(content).toBe('new')
  })

  it('renames on conflict without extension', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'Makefile'), 'existing')
    const result = await safeWriteFile(targetDir, 'Makefile', Buffer.from('new'))
    expect(result.savedName).toBe('Makefile-1')
  })

  it('increments suffix until a free name is found', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'img.png'), 'v0')
    await writeFile(path.join(targetDir, 'img-1.png'), 'v1')
    await writeFile(path.join(targetDir, 'img-2.png'), 'v2')
    const result = await safeWriteFile(targetDir, 'img.png', Buffer.from('v3'))
    expect(result.savedName).toBe('img-3.png')
  })

  it('strips directory components from filename', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    const result = await safeWriteFile(targetDir, '../../etc/passwd', Buffer.from('safe'))
    expect(result.savedName).toBe('passwd')
    expect(result.originalName).toBe('passwd')
    // File should be in targetDir, not elsewhere
    const content = await readFile(path.join(targetDir, 'passwd'), 'utf-8')
    expect(content).toBe('safe')
  })
})

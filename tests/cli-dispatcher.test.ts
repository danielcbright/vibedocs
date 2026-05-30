import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises'
import path from 'path'
import os from 'os'
import { main } from '../src/cli/index.js'

/**
 * CLI dispatcher seam test (#108, Seam 5). The dispatcher decides:
 *   - --help / -h / no subcommand → usage to stdout + exit 0/1
 *   - unknown subcommand → usage to stderr + exit non-zero
 *   - build → parse args, run, propagate error exit codes
 *
 * Tests capture process.stdout/stderr writes via spies and call `main()`
 * directly so we never spawn a child process.
 */

let stdoutSpy: ReturnType<typeof vi.spyOn>
let stderrSpy: ReturnType<typeof vi.spyOn>
let tmpDir: string
let projectsRoot: string
let projectPath: string
let outDir: string
let frontendDist: string

beforeEach(async () => {
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-cli-dispatch-'))
  projectsRoot = path.join(tmpDir, 'projects')
  projectPath = path.join(projectsRoot, 'demo')
  outDir = path.join(tmpDir, 'dist')
  frontendDist = path.join(tmpDir, 'frontend-dist')

  await mkdir(projectPath, { recursive: true })
  await writeFile(path.join(projectPath, 'README.md'), '# Demo\n\nbody.')
  await mkdir(path.join(frontendDist, 'assets'), { recursive: true })
  await writeFile(
    path.join(frontendDist, 'index.html'),
    '<!doctype html><html><head>'
      + '<script type="module" src="/assets/index-FAKE.js"></script>'
      + '<link rel="stylesheet" href="/assets/index-FAKE.css">'
      + '</head><body><div id="root"></div></body></html>',
  )
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKE.js'), '/*fake*/')
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKE.css'), '/*fake*/')
})

afterEach(async () => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
  await rm(tmpDir, { recursive: true, force: true })
})

function stdoutString(): string {
  return stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
}
function stderrString(): string {
  return stderrSpy.mock.calls.map((c) => String(c[0])).join('')
}

describe('CLI dispatcher — usage / --help', () => {
  it('--help prints usage to stdout and exits 0', async () => {
    const code = await main(['--help'])
    expect(code).toBe(0)
    expect(stdoutString()).toMatch(/Usage:[\s\S]*vibedocs build/)
    // Usage banner does NOT leak to stderr.
    expect(stderrString()).toBe('')
  })

  it('-h is treated the same as --help', async () => {
    const code = await main(['-h'])
    expect(code).toBe(0)
    expect(stdoutString()).toMatch(/Usage:/)
  })

  it('no subcommand prints usage to stdout and exits non-zero', async () => {
    const code = await main([])
    expect(code).not.toBe(0)
    expect(stdoutString()).toMatch(/Usage:/)
  })
})

describe('CLI dispatcher — unknown subcommand', () => {
  it('exits non-zero and writes an informative message + usage to stderr', async () => {
    const code = await main(['serve'])
    expect(code).not.toBe(0)
    const err = stderrString()
    expect(err).toMatch(/Unknown subcommand: serve/)
    expect(err).toMatch(/Usage:/)
  })
})

describe('CLI dispatcher — build subcommand error paths', () => {
  it('errors clearly when --project is missing', async () => {
    const code = await main(['build', '--out', outDir])
    expect(code).not.toBe(0)
    const err = stderrString()
    expect(err).toMatch(/vibedocs build:.*--project/)
    expect(err).toMatch(/Usage:/)
  })

  it('errors clearly on an unknown flag', async () => {
    const code = await main(['build', '--project', 'demo', '--what'])
    expect(code).not.toBe(0)
    const err = stderrString()
    expect(err).toMatch(/vibedocs build:.*unknown flag/i)
  })

  it('propagates a non-zero exit code when underlying build throws', async () => {
    // No projectsRoot/no frontend-dist for an unknown project name → build
    // throws → dispatcher returns 1.
    const prev = process.env.VIBEDOCS_ROOT
    process.env.VIBEDOCS_ROOT = projectsRoot
    try {
      const code = await main([
        'build',
        '--project', 'does-not-exist',
        '--out', outDir,
        '--frontend-dist', frontendDist,
      ])
      expect(code).not.toBe(0)
      expect(stderrString()).toMatch(/vibedocs build:/)
    } finally {
      if (prev === undefined) delete process.env.VIBEDOCS_ROOT
      else process.env.VIBEDOCS_ROOT = prev
    }
  })
})

describe('CLI dispatcher — successful build', () => {
  it('runs a real build end-to-end and exits 0', async () => {
    const prev = process.env.VIBEDOCS_ROOT
    process.env.VIBEDOCS_ROOT = projectsRoot
    try {
      const code = await main([
        'build',
        '--project', 'demo',
        '--out', outDir,
        '--frontend-dist', frontendDist,
      ])
      if (code !== 0) {
        // Surface stderr so the failure is debuggable rather than a bare 1.
        throw new Error(`expected exit 0, got ${code}; stderr=${stderrString()}`)
      }
      // Success message lands on stdout.
      expect(stdoutString()).toMatch(/Built site to/)
    } finally {
      if (prev === undefined) delete process.env.VIBEDOCS_ROOT
      else process.env.VIBEDOCS_ROOT = prev
    }
  })
})

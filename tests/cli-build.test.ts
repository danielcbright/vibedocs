import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, readFile, stat } from 'fs/promises'
import path from 'path'
import os from 'os'
import { runBuild, resolveProjectPath } from '../src/cli/build.js'

// ── helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string
let projectsRoot: string
let projectPath: string
let outDir: string
let frontendDist: string

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'vibedocs-build-cli-'))
  projectsRoot = path.join(tmpDir, 'projects')
  projectPath = path.join(projectsRoot, 'myproject')
  outDir = path.join(tmpDir, 'dist')
  frontendDist = path.join(tmpDir, 'frontend-dist')

  await mkdir(projectPath, { recursive: true })
  await mkdir(path.join(projectPath, 'docs'))
  await writeFile(path.join(projectPath, 'README.md'), '# My Project\n\nWelcome.')
  await writeFile(
    path.join(projectPath, 'docs', 'install.md'),
    '# Install\n\nRun `npm install`.',
  )
  // An asset that markdown might reference.
  await mkdir(path.join(projectPath, 'docs', 'images'))
  await writeFile(path.join(projectPath, 'docs', 'images', 'diagram.png'), 'PNG-FAKE-BYTES')

  // Minimal pretend "frontend build" output.
  await mkdir(path.join(frontendDist, 'assets'), { recursive: true })
  await writeFile(
    path.join(frontendDist, 'index.html'),
    '<!doctype html><html><head><title>X</title>'
      + '<script type="module" src="/assets/index-FAKEHASH.js"></script>'
      + '</head><body><div id="root"></div></body></html>',
  )
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKEHASH.js'), 'console.log("hi")')
  await writeFile(path.join(frontendDist, 'assets', 'index-FAKEHASH.css'), 'body{margin:0}')
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

describe('runBuild — file emission', () => {
  it('emits one HTML file per markdown source at clean URLs', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    // README.md → dist/index.html (site root)
    expect(await pathExists(path.join(outDir, 'index.html'))).toBe(true)
    // docs/install.md → dist/docs/install/index.html
    expect(await pathExists(path.join(outDir, 'docs', 'install', 'index.html'))).toBe(true)
  })

  it('copies the React bundle from frontend-dist/assets/ into <out>/assets/', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.js'))).toBe(true)
    expect(await pathExists(path.join(outDir, 'assets', 'index-FAKEHASH.css'))).toBe(true)
  })

  it('mirrors non-markdown asset files to dist/<source-path>', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const mirroredAsset = path.join(outDir, 'docs', 'images', 'diagram.png')
    expect(await pathExists(mirroredAsset)).toBe(true)
    const bytes = await readFile(mirroredAsset, 'utf-8')
    expect(bytes).toBe('PNG-FAKE-BYTES')
  })

  it('embeds the rendered page html and references the bundle entry script', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const installHtml = await readFile(
      path.join(outDir, 'docs', 'install', 'index.html'),
      'utf-8',
    )
    expect(installHtml).toMatch(/<h1[^>]*>.*Install.*<\/h1>/s)
    expect(installHtml).toContain('npm install')
    // Bundle entry is auto-detected from frontend-dist/index.html's <script>
    expect(installHtml).toContain('src="/assets/index-FAKEHASH.js"')
    expect(installHtml).toContain('<meta charset="UTF-8"')
  })

  it('uses page H1 as the <title> when available', async () => {
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
    })

    const html = await readFile(
      path.join(outDir, 'docs', 'install', 'index.html'),
      'utf-8',
    )
    expect(html).toMatch(/<title>Install<\/title>/)
  })
})

describe('runBuild — base URL', () => {
  it('threads --base-url through (presence check; full canonical lands in slice #5)', async () => {
    // For slice #49 we only need to prove the option doesn't crash and the
    // build completes. Real canonical-URL emission is slice #50/#54.
    await runBuild({
      projectName: 'myproject',
      projectsRoot,
      outDir,
      frontendDist,
      baseUrl: 'https://example.com',
    })

    expect(await pathExists(path.join(outDir, 'index.html'))).toBe(true)
  })
})

describe('runBuild — error paths', () => {
  it('throws an actionable error when the project does not exist', async () => {
    await expect(
      runBuild({
        projectName: 'does-not-exist',
        projectsRoot,
        outDir,
        frontendDist,
      }),
    ).rejects.toThrow(/does-not-exist/)
  })

  it('throws when frontend-dist has no built bundle', async () => {
    await rm(frontendDist, { recursive: true, force: true })
    await mkdir(frontendDist, { recursive: true })

    await expect(
      runBuild({
        projectName: 'myproject',
        projectsRoot,
        outDir,
        frontendDist,
      }),
    ).rejects.toThrow(/frontend.*build|bundle/i)
  })
})

describe('resolveProjectPath', () => {
  it('returns <root>/<name> when that directory exists', async () => {
    const resolved = await resolveProjectPath('myproject', projectsRoot, projectsRoot)
    expect(resolved).toBe(projectPath)
  })

  it('falls back to cwd when its basename matches the project name', async () => {
    // Simulates `vibedocs build --project vibedocs` run from inside the
    // vibedocs repo itself, where there is no `vibedocs/vibedocs/` subdir.
    const standaloneRoot = path.join(tmpDir, 'standalone-root')
    await mkdir(standaloneRoot)
    const vibedocsLike = path.join(standaloneRoot, 'vibedocs')
    await mkdir(vibedocsLike)
    await writeFile(path.join(vibedocsLike, 'README.md'), '# v')

    const resolved = await resolveProjectPath(
      'vibedocs',
      standaloneRoot, // PROJECTS_DIR
      vibedocsLike, // cwd
    )
    expect(resolved).toBe(vibedocsLike)
  })

  it('falls back to cwd when the local package.json name matches', async () => {
    // Simulates running from a worktree dir whose basename is a branch slug
    // (e.g. agent-abc123), where the package.json there declares the project
    // name. This is how `npx tsx bin/vibedocs build --project vibedocs` works
    // from inside a vibedocs worktree.
    const worktreeDir = path.join(tmpDir, 'worktree-xyz')
    await mkdir(worktreeDir)
    await writeFile(
      path.join(worktreeDir, 'package.json'),
      JSON.stringify({ name: 'pkgname', version: '0.0.0' }),
    )

    const resolved = await resolveProjectPath(
      'pkgname',
      path.join(tmpDir, 'no-such-projects-root'),
      worktreeDir,
    )
    expect(resolved).toBe(worktreeDir)
  })

  it('throws when neither the sibling nor the cwd matches', async () => {
    await expect(
      resolveProjectPath('nope', projectsRoot, projectsRoot),
    ).rejects.toThrow(/nope/)
  })
})

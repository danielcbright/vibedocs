import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile, readFile, stat, readdir } from 'fs/promises'
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
    '# Install\n\nRun `npm install`.\n\n![diagram](./images/diagram.png)',
  )
  // An asset referenced by docs/install.md above.
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

describe('runBuild — referenced-asset filtering and summary (#74)', () => {
  async function collectDistFiles(dir: string, base = dir): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const result: string[] = []
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        result.push(...await collectDistFiles(full, base))
      } else {
        result.push(path.relative(base, full))
      }
    }
    return result
  }

  it('dist/ contains no .ts files, no package.json when project has source-tree noise', async () => {
    // Add source-tree noise that should NOT appear in dist/ because no doc
    // references it.
    await writeFile(path.join(projectPath, 'server.ts'), 'export {}')
    await writeFile(path.join(projectPath, 'package.json'), '{"name":"noise"}')
    await writeFile(path.join(projectPath, 'LICENSE'), 'MIT')

    await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })

    const files = await collectDistFiles(outDir)
    const tsFiles = files.filter((f) => f.endsWith('.ts'))
    const pkgFiles = files.filter((f) => f.endsWith('package.json'))
    const licFiles = files.filter((f) => f === 'LICENSE')
    expect(tsFiles).toHaveLength(0)
    expect(pkgFiles).toHaveLength(0)
    expect(licFiles).toHaveLength(0)
  })

  it('build summary contains "Copied N referenced assets"', async () => {
    const stdoutLines: string[] = []
    const origWrite = process.stdout.write.bind(process.stdout)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stdoutLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stdoutLines.join('')
    expect(combined).toMatch(/Copied \d+ referenced assets/)
  })

  it('emits a warning to stderr for each missing asset reference', async () => {
    // README.md references a file that does not exist on disk.
    await writeFile(
      path.join(projectPath, 'README.md'),
      '# My Project\n\nWelcome.\n\n![missing](./ghost.png)',
    )

    const stderrLines: string[] = []
    const origWrite = process.stderr.write.bind(process.stderr)
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk, ...args) => {
      if (typeof chunk === 'string') stderrLines.push(chunk)
      return origWrite(chunk, ...args)
    })

    try {
      await runBuild({ projectName: 'myproject', projectsRoot, outDir, frontendDist })
    } finally {
      vi.restoreAllMocks()
    }

    const combined = stderrLines.join('')
    expect(combined).toMatch(/warning:.*README\.md.*references.*ghost\.png.*does not exist/)
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

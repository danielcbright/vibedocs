import { describe, it, expect } from 'vitest'
import path from 'path'
import { toProjectRelativePath } from '../src/discovery.js'
import { reloadMessage } from '../src/shared/ws-messages.js'

describe('toProjectRelativePath', () => {
  const projectsDir = '/example/projects'

  it('strips the projects dir prefix and returns <project>/<rel>', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'docs', 'guide.md')
    expect(toProjectRelativePath(abs, projectsDir)).toBe('vibedocs/docs/guide.md')
  })

  it('handles a file at the project root', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'README.md')
    expect(toProjectRelativePath(abs, projectsDir)).toBe('vibedocs/README.md')
  })

  it('handles a deeply nested file', () => {
    const abs = path.join(projectsDir, 'demo', 'docs', 'specs', '2026', 'plan.md')
    expect(toProjectRelativePath(abs, projectsDir)).toBe(
      'demo/docs/specs/2026/plan.md',
    )
  })

  it('returns null when the path is outside the projects dir', () => {
    expect(toProjectRelativePath('/etc/passwd', projectsDir)).toBeNull()
    expect(
      toProjectRelativePath('/example/elsewhere/file.md', projectsDir),
    ).toBeNull()
  })

  it('returns null for the projects dir itself (no project segment)', () => {
    expect(toProjectRelativePath(projectsDir, projectsDir)).toBeNull()
  })

  it('returns null for a path that resolves outside via traversal', () => {
    // A literal absolute path that doesn't start with projectsDir
    expect(
      toProjectRelativePath('/example/other/foo.md', projectsDir),
    ).toBeNull()
  })

  it('produces forward-slash paths regardless of platform separators', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'docs', 'guide.md')
    const result = toProjectRelativePath(abs, projectsDir)
    expect(result).not.toContain('\\')
  })

  it('never leaks the projects dir prefix in the result', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'docs', 'guide.md')
    const result = toProjectRelativePath(abs, projectsDir)
    expect(result).not.toContain(projectsDir)
    expect(result).not.toMatch(/^\/example/)
  })
})

/**
 * Mirror of the transformation the chokidar 'change' handler in
 * src/server.ts performs before broadcasting. Keeping it inline avoids
 * importing src/server.ts (which has start-server side effects).
 */
function simulateChokidarChangeBroadcast(
  filePath: string,
  projectsDir: string,
) {
  const rel = toProjectRelativePath(filePath, projectsDir)
  return rel === null ? null : reloadMessage(rel)
}

describe('chokidar change → reload broadcast wire format', () => {
  const projectsDir = '/example/projects'

  it('broadcast.path does NOT contain the projects dir prefix', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'docs', 'guide.md')
    const msg = simulateChokidarChangeBroadcast(abs, projectsDir)
    expect(msg).not.toBeNull()
    expect(msg!.path).not.toContain(projectsDir)
    expect(msg!.path).not.toMatch(/^\/example/)
    expect(msg!.path.startsWith('/')).toBe(false)
  })

  it('broadcast.path matches the project-relative <project>/<rel> form', () => {
    const abs = path.join(projectsDir, 'vibedocs', 'docs', 'guide.md')
    const msg = simulateChokidarChangeBroadcast(abs, projectsDir)
    expect(msg).toEqual({
      type: 'reload',
      path: 'vibedocs/docs/guide.md',
    })
  })

  it('skips the broadcast entirely when the path is outside PROJECTS_DIR', () => {
    expect(
      simulateChokidarChangeBroadcast('/etc/passwd', projectsDir),
    ).toBeNull()
  })
})

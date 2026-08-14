/**
 * Where projects are looked for.
 *
 * One root was the original model (`VIBEDOCS_ROOT`, or the working directory);
 * `VIBEDOCS_ROOTS` takes a colon-separated list (#113). Everything in this module
 * is pure — filesystem questions are asked through an injected `dirExists` — so
 * the naming rules below are testable without a filesystem, and so the path
 * resolver can stay the stateless allocation ADR-0001 requires.
 *
 * Colon is POSIX-only and deliberately not `path.delimiter`: this project's CI
 * covers Linux and macOS only, and `ci.yml` states Windows is out until it is
 * actually supported. A separator nobody can test is not a feature.
 */
import path from 'path'

/** Separator for `VIBEDOCS_ROOTS`. POSIX-only, see the module note. */
export const ROOTS_SEPARATOR = ':'

/**
 * Qualifier between a project name and the root that holds it, for the case where
 * two roots offer the same project name.
 *
 * `~` is chosen against three constraints, and it is the only common punctuation
 * that satisfies all of them:
 *
 * 1. **Not `/`.** The name is one whole URL path segment (`/api/render/:project/*`)
 *    and it is everything before the first `/` in the hash route.
 * 2. **Never percent-encoded by a browser**, in a path or a fragment — the hash
 *    router does not decode what it reads.
 * 3. **Never escaped by `encodeURIComponent` either**, so the encoded and verbatim
 *    spellings are the same string. `@` fails this one, and that is not academic:
 *    it walked straight into a real bug in `extractProjectPath`, which rebuilt the
 *    expected URL prefix with `encodeURIComponent(project)` and so 400'd on a name
 *    the client had spelled verbatim. That bug is fixed, but a qualifier that
 *    cannot depend on the fix is better than one that must.
 */
export const ROOT_QUALIFIER = '~'

export type ParseRootsResult =
  | { ok: true; roots: string[]; notes?: string[] }
  | { ok: false; error: string }

/**
 * Resolve the configured roots, or explain why the configuration cannot work.
 *
 * Two arrangements are rejected rather than accepted-and-coped-with, because both
 * are silently wrong rather than merely unusual:
 *
 * - **Shared basenames.** The qualified name for a colliding project is
 *   `<name>@<rootBasename>`, so two roots named `docs` make it ambiguous.
 * - **Nesting.** With `/a` and `/a/b`, every file under `b` is discovered twice
 *   under two different project names, and every watcher event fires twice.
 */
export function parseRoots(
  env: Record<string, string | undefined>,
  cwd: string,
): ParseRootsResult {
  const notes: string[] = []
  const raw = env.VIBEDOCS_ROOTS

  let candidates: string[]
  if (raw !== undefined && raw.split(ROOTS_SEPARATOR).some((e) => e.trim().length > 0)) {
    candidates = raw
      .split(ROOTS_SEPARATOR)
      .map((entry) => entry.trim())
      // An empty entry (a trailing colon, say) would resolve to the working
      // directory — quietly adding an enormous root, which is the failure #113
      // opens with.
      .filter((entry) => entry.length > 0)
    if (env.VIBEDOCS_ROOT) {
      notes.push('VIBEDOCS_ROOTS is set, so VIBEDOCS_ROOT is ignored.')
    }
  } else {
    if (raw !== undefined) notes.push('VIBEDOCS_ROOTS was set but empty; ignoring it.')
    candidates = [env.VIBEDOCS_ROOT || cwd]
  }

  const roots: string[] = []
  for (const candidate of candidates) {
    const resolved = path.resolve(cwd, candidate)
    // `/a/` and `/a` are one root; path.resolve already drops the trailing
    // separator, so this only guards the duplicate-entry case.
    if (!roots.includes(resolved)) roots.push(resolved)
  }

  const conflict = findRootConflict(roots)
  if (conflict) return { ok: false, error: conflict }

  return { ok: true, roots, ...(notes.length > 0 ? { notes } : {}) }
}

function findRootConflict(roots: readonly string[]): string | null {
  const byBasename = new Map<string, string>()
  for (const root of roots) {
    const base = path.basename(root)
    const seen = byBasename.get(base)
    if (seen !== undefined) {
      return (
        `Two roots share the basename "${base}": ${seen} and ${root}. ` +
        'A project found in both would have the same qualified name. Rename one, or point at distinct parents.'
      )
    }
    byBasename.set(base, root)
  }

  for (const outer of roots) {
    for (const inner of roots) {
      if (inner === outer) continue
      if (isWithin(inner, outer)) {
        return (
          `Root ${inner} is nested inside root ${outer}. ` +
          'Everything under the inner one would be discovered twice under two names, and every file event would fire twice.'
        )
      }
    }
  }

  return null
}

/** True when `target` sits inside `root`. Both must be absolute. */
function isWithin(target: string, root: string): boolean {
  return target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
}

/** Does this absolute path name a directory? Injected so the rules below stay pure. */
export type DirExists = (absPath: string) => boolean

/**
 * The name a project directory is known by.
 *
 * Unqualified when no *earlier* root offers a project of the same name, and
 * `<name>@<rootBasename>` when one does. The asymmetry is deliberate: appending a
 * root must never rename an existing project, because a project name is the
 * routing key that every saved link contains.
 *
 * Returns null for a directory under no configured root.
 */
export function projectNameFor(
  roots: readonly string[],
  projectDir: string,
  dirExists: DirExists,
): string | null {
  const index = roots.findIndex((root) => isWithin(projectDir, root))
  if (index === -1) return null

  const name = path.relative(roots[index], projectDir)
  // Only a direct child of a root is a project; anything deeper is a file inside one.
  if (name === '' || name.includes(path.sep)) return null

  const shadowed = roots
    .slice(0, index)
    .some((earlier) => dirExists(path.join(earlier, name)))

  return shadowed ? `${name}${ROOT_QUALIFIER}${path.basename(roots[index])}` : name
}

/**
 * The inverse: a project name from a URL back to its root and directory.
 *
 * This is `projectNameFor` read backwards and the two must agree — discovery names
 * projects, the search index names them again while walking, and this turns a name
 * from a request back into a directory. A disagreement shows up as a search result
 * that 404s, with nothing anywhere explaining why, so both live in this file and
 * are round-trip tested.
 *
 * Returns null when no root offers the name, which callers should treat as
 * not-found. A qualified name whose root is not configured is also null: resolving
 * it would be a way to ask about a directory outside the roots.
 */
export function locateProject(
  roots: readonly string[],
  project: string,
  dirExists: DirExists,
): { root: string; dir: string } | null {
  const at = project.lastIndexOf(ROOT_QUALIFIER)
  if (at > 0) {
    const bare = project.slice(0, at)
    const rootBasename = project.slice(at + ROOT_QUALIFIER.length)
    const root = roots.find((r) => path.basename(r) === rootBasename)
    // Fall through when the suffix names no root: the whole string may be a folder
    // that genuinely contains an `@`.
    if (root !== undefined) {
      const found = within(root, bare, dirExists)
      if (found !== null) return found
    }
  }

  for (const root of roots) {
    const found = within(root, project, dirExists)
    if (found !== null) return found
  }
  return null
}

/**
 * `<root>/<name>` when that is a directory strictly inside `root`.
 *
 * The containment check is what stops a name like `..` from naming the root's
 * parent. The path resolver checks again on its own; this is the first line, not
 * the only one.
 */
function within(root: string, name: string, dirExists: DirExists): { root: string; dir: string } | null {
  if (name === '') return null
  const dir = path.resolve(root, name)
  if (!isWithin(dir, root)) return null
  if (path.relative(root, dir).includes(path.sep)) return null
  return dirExists(dir) ? { root, dir } : null
}

/**
 * Which root a one-project command should build from.
 *
 * `vibedocs build` renders a single named project, so it needs one root, not a
 * list. Picking the root that actually holds the project keeps `VIBEDOCS_ROOTS`
 * from breaking a build for a project that lives anywhere but first — which
 * would fail as "project not found" and point the operator at the wrong thing.
 *
 * Falls back to the first root when no root has it, so the build's own
 * not-found message (and its cwd-basename fallback) still get their chance.
 */
export function resolveBuildRoot(
  roots: readonly string[],
  projectName: string,
  dirExists: DirExists,
): string {
  return locateProject(roots, projectName, dirExists)?.root ?? roots[0]
}

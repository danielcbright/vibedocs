/**
 * Checking and saving a roots selection.
 *
 * The conflict rules (shared basenames, nesting) are `checkRootSelection`'s, i.e.
 * the server's own boot refusal — nothing here restates them. What is added is
 * only what a picker needs and a hand-typed env var never did: that each path is
 * absolute, writable to the line-based file, and an existing folder.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'fs/promises'
import path from 'path'
import { checkRootSelection, formatRootsFile, parseRootsFile, pruneRules } from '../project-roots.js'
import { NO_RULES, type VisibilityRules } from '../shared/project-visibility.js'
import type { RootsCheck } from '../shared/settings-types.js'

const MAX_ROOTS = 64

export async function checkSelection(input: unknown, rulesInput: unknown = NO_RULES): Promise<RootsCheck> {
  if (!Array.isArray(input) || !input.every((r) => typeof r === 'string')) {
    return { ok: false, error: 'Expected a list of folder paths.' }
  }
  const roots: string[] = []
  for (const raw of input as string[]) {
    const r = raw.trim()
    // A newline or NUL would split or truncate the line-based roots file.
    if (/[\n\r\0]/.test(r)) return { ok: false, error: `“${r}” contains a line break.` }
    if (!path.isAbsolute(r)) return { ok: false, error: `“${r}” is not an absolute path.` }
    const resolved = path.resolve(r)
    if (!roots.includes(resolved)) roots.push(resolved)
  }
  if (roots.length === 0) return { ok: false, error: 'Choose at least one folder.' }
  if (roots.length > MAX_ROOTS) return { ok: false, error: `Choose at most ${MAX_ROOTS} folders.` }

  for (const r of roots) {
    try {
      if (!(await stat(r)).isDirectory()) return { ok: false, error: `${r} is not a folder.` }
    } catch {
      return { ok: false, error: `${r} does not exist.` }
    }
  }

  const conflict = checkRootSelection(roots)
  if (conflict !== null) return { ok: false, error: conflict }

  const rules = parseRules(rulesInput)
  if (typeof rules === 'string') return { ok: false, error: rules }
  // A rule for a root that was just unticked is dropped, not refused: the page
  // would otherwise have to clean up after every untick before it could save.
  return { ok: true, roots, rules: pruneRules(rules, roots) }
}

function parseRules(input: unknown): VisibilityRules | string {
  if (input === undefined || input === null) return NO_RULES
  const r = input as Record<string, unknown>
  const lists: Array<keyof VisibilityRules> = ['hide', 'show', 'showWorktrees']
  const out: Record<string, string[]> = {}
  for (const key of lists) {
    const list = r[key] ?? []
    if (!Array.isArray(list) || !list.every((p) => typeof p === 'string')) return 'Expected lists of folder paths.'
    out[key] = []
    for (const p of list as string[]) {
      if (/[\n\r\0]/.test(p)) return `“${p}” contains a line break.`
      if (!path.isAbsolute(p)) return `“${p}” is not an absolute path.`
      const resolved = path.resolve(p)
      if (!out[key].includes(resolved)) out[key].push(resolved)
    }
  }
  return out as unknown as VisibilityRules
}

/** Write the roots file atomically, so a crash mid-write cannot leave the next boot a half file. */
export async function writeRootsFile(
  file: string,
  roots: readonly string[],
  rules: VisibilityRules = NO_RULES,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, formatRootsFile(roots, rules), { mode: 0o644 })
  await rename(tmp, file)
}

/** What the roots file holds now, or null when it is missing or unparseable. */
export async function readRootsFile(file: string): Promise<{ roots: string[]; rules: VisibilityRules } | null> {
  try {
    const parsed = parseRootsFile(await readFile(file, 'utf-8'))
    return parsed.ok ? { roots: parsed.roots, rules: pruneRules(parsed.rules, parsed.roots) } : null
  } catch {
    return null
  }
}

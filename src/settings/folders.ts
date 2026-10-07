/**
 * The folder tree the roots picker shows: the home folder and below, one level per
 * request, each row with a bounded markdown count.
 *
 * Bounded because it runs in the live server on a click: a count stops at
 * `MARKDOWN_CAP` files, four levels down (what the old terminal picker's `find
 * -maxdepth 4` looked at), or `ENTRY_BUDGET` directory entries, whichever comes
 * first. It holds no file contents, so concurrency is not the memory risk the
 * search walk is.
 */
import { readdir, stat } from 'fs/promises'
import path from 'path'
import { EXCLUDED_DIRS } from '../excluded-paths.js'
import { isMarkdownPath } from '../markdown-paths.js'
import { VibedocsError } from '../errors.js'
import type { FolderEntry, FolderListing } from '../shared/settings-types.js'

/**
 * Home-level folders the picker never offers: application state and media
 * libraries, which hold no documentation and are huge. Carried over from the
 * terminal picker this replaces.
 */
const HIDDEN_AT_HOME = new Set(['Library', 'Applications', 'Movies', 'Music', 'Pictures'])

/**
 * macOS privacy-protected (TCC). A LaunchAgent whose roots include one blocks
 * before binding its port and logs nothing, unless node has Full Disk Access. The
 * picker flags them and does not count inside them: from the live service that
 * read is the very thing that blocks.
 */
const PROTECTED_AT_HOME = new Set(['Documents', 'Desktop', 'Downloads'])

export const MARKDOWN_CAP = 1000
const MAX_DEPTH = 4
const ENTRY_BUDGET = 20_000
const LIST_TIMEOUT_MS = 5_000

export async function listFolders(dir: string, home: string): Promise<FolderListing> {
  if (!path.isAbsolute(dir)) throw new VibedocsError('invalid', 'A folder path must be absolute')
  const target = path.resolve(dir)
  const top = path.resolve(home)
  if (target !== top && !target.startsWith(top + path.sep)) {
    throw new VibedocsError('forbidden', 'Only folders inside your home folder are listed')
  }
  // The same rule the resolver and discovery apply, so the picker cannot be used
  // to look inside a folder the rest of VibeDocs refuses to.
  if (target !== top && path.relative(top, target).split(path.sep).some(isHiddenName)) {
    throw new VibedocsError('forbidden', 'Hidden and excluded folders are not listed')
  }

  const atHome = target === top
  const names = await withTimeout(readChildDirs(target), LIST_TIMEOUT_MS)
  const visible = names.filter((n) => !(atHome && HIDDEN_AT_HOME.has(n)))

  const folders: FolderEntry[] = await Promise.all(
    visible.map(async (name) => {
      const full = path.join(target, name)
      const isProtected = atHome && PROTECTED_AT_HOME.has(name)
      const counted = isProtected ? null : await countMarkdown(full)
      return {
        name,
        path: full,
        markdown: counted?.count ?? null,
        capped: counted?.capped ?? false,
        protected: isProtected,
      }
    }),
  )
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return { path: target, parent: atHome ? null : path.dirname(target), folders }
}

function isHiddenName(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name)
}

/** Child directory names (symlinks to directories included), minus hidden and excluded ones. */
async function readChildDirs(dir: string): Promise<string[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err: any) {
    if (err?.code === 'ENOENT' || err?.code === 'ENOTDIR') {
      throw new VibedocsError('not-found', 'No such folder', { cause: err })
    }
    if (err?.code === 'EPERM' || err?.code === 'EACCES') {
      throw new VibedocsError(
        'forbidden',
        'Cannot read this folder. If it is under Documents, Desktop or Downloads, macOS privacy controls need Full Disk Access granted to node.',
        { cause: err },
      )
    }
    throw new VibedocsError('io', 'Failed to read folder', { cause: err })
  }

  const names: string[] = []
  for (const entry of entries) {
    if (isHiddenName(entry.name)) continue
    if (entry.isDirectory()) {
      names.push(entry.name)
    } else if (entry.isSymbolicLink()) {
      try {
        if ((await stat(path.join(dir, entry.name))).isDirectory()) names.push(entry.name)
      } catch {
        // A dangling link is not a folder anyone can pick.
      }
    }
  }
  return names
}

/**
 * Markdown files at most four levels below `dir`. `capped` means the count is a
 * lower bound: it hit the file cap or the entry budget, or left a folder unread at
 * the depth limit. Without the last, a parent reads "522" beside a child's
 * "1,000+", because the child's four levels reach one further down.
 */
export async function countMarkdown(dir: string): Promise<{ count: number; capped: boolean }> {
  let count = 0
  let truncated = false
  let budget = ENTRY_BUDGET
  const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 1 }]

  while (stack.length > 0) {
    const { dir: current, depth } = stack.pop()!
    let entries: import('fs').Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (--budget < 0) return { count, capped: true }
      if (isHiddenName(entry.name)) continue
      if (entry.isFile() && isMarkdownPath(entry.name)) {
        if (++count >= MARKDOWN_CAP) return { count, capped: true }
      } else if (entry.isDirectory()) {
        if (depth < MAX_DEPTH) stack.push({ dir: path.join(current, entry.name), depth: depth + 1 })
        else truncated = true
      }
    }
  }
  return { count, capped: truncated }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new VibedocsError('io', 'Timed out reading this folder. macOS privacy controls can block a background service without saying so.')),
      ms,
    )
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

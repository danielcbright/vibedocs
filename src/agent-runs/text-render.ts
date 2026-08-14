/**
 * Markdown rendering for transcript text.
 *
 * Runs on the server using the project's existing unified pipeline — the spec
 * rules out react-markdown and a client-side highlighter as duplication.
 * Results are cached by content, because a timeline re-reads the same events on
 * every reconnect and the same assistant message often recurs across runs.
 */

import { createHash } from 'crypto'
import { createAgentTextProcessor } from '../markdown-processor.js'
import type { EventRecord, EventKind } from '../shared/agent-run-types.js'

/** Kinds whose `text` is markdown. Thinking stays plain — it is raw reasoning. */
const MARKDOWN_KINDS: readonly EventKind[] = ['assistant', 'result', 'user']

const DEFAULT_MAX_ENTRIES = 512

export interface TextRenderer {
  render(markdown: string): Promise<string>
  readonly size: number
}

export function createTextRenderer(opts: { maxEntries?: number } = {}): TextRenderer {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const cache = new Map<string, string>()
  const processor = createAgentTextProcessor()

  return {
    async render(markdown) {
      if (!markdown || markdown.trim().length === 0) return ''
      const key = createHash('sha256').update(markdown).digest('hex')
      const hit = cache.get(key)
      if (hit !== undefined) {
        cache.delete(key)
        cache.set(key, hit) // refresh LRU position
        return hit
      }
      const html = String(await processor.process(markdown))
      cache.set(key, html)
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return html
    },
    get size() {
      return cache.size
    },
  }
}

/**
 * Attach `textHtml` to markdown-bearing append records. Returns new objects —
 * the caller's records (and therefore anything on its way to disk) are untouched.
 */
export async function enrichRecords(
  records: readonly EventRecord[],
  renderer: TextRenderer,
): Promise<EventRecord[]> {
  return Promise.all(
    records.map(async (rec) => {
      if (rec.op !== 'append') return rec
      const { kind, text } = rec.event
      if (!MARKDOWN_KINDS.includes(kind) || !text) return rec
      return { op: 'append' as const, event: { ...rec.event, textHtml: await renderer.render(text) } }
    }),
  )
}


// ── Tool-output highlighting ─────────────────────────────────────────────────
//
// Lazy by design: tool output can be 256 KB and most rows are never expanded,
// so highlighting at read time would pay for output nobody looks at. The route
// highlights one event's output on demand and caches by content.

import { codeToHtml } from 'shiki'

/** Languages we will ask shiki for. Anything else falls back to plain text. */
const SAFE_LANGS = new Set([
  'bash', 'typescript', 'javascript', 'go', 'python', 'yaml', 'json', 'markdown', 'text',
])

export interface CodeHighlighter {
  highlight(code: string, lang: string): Promise<string>
  readonly size: number
}

export function createCodeHighlighter(opts: { maxEntries?: number } = {}): CodeHighlighter {
  const maxEntries = opts.maxEntries ?? 128
  const cache = new Map<string, string>()

  return {
    async highlight(code, lang) {
      if (!code) return ''
      const language = SAFE_LANGS.has(lang) ? lang : 'text'
      const key = createHash('sha256').update(language + '\u0000' + code).digest('hex')
      const hit = cache.get(key)
      if (hit !== undefined) {
        cache.delete(key)
        cache.set(key, hit)
        return hit
      }
      let html: string
      try {
        html = await codeToHtml(code, {
          lang: language,
          themes: { light: 'github-light', dark: 'github-dark' },
          defaultColor: false,
        })
      } catch {
        // A language shiki cannot load must not fail the request; the client
        // already renders plain preformatted text as its own fallback.
        return ''
      }
      cache.set(key, html)
      while (cache.size > maxEntries) {
        const oldest = cache.keys().next().value as string | undefined
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return html
    },
    get size() { return cache.size },
  }
}

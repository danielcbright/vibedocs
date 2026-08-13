import { openSync, readSync, closeSync, statSync } from 'node:fs'

/**
 * Read a growing NDJSON transcript from a byte offset and return whole parsed
 * lines plus the new offset.
 *
 * A partial trailing line is deliberately left behind for the next read rather
 * than parsed as truncated JSON — the agent may be mid-write when we look, and
 * treating that as corrupt would drop a real event.
 *
 * Extracted so the replay script and the supervisor share one tailer; two copies
 * of this offset arithmetic would drift.
 */
export function readFrom(filePath, offset) {
  const size = statSync(filePath).size
  if (size <= offset) return { lines: [], offset }

  const fd = openSync(filePath, 'r')
  const buf = Buffer.alloc(size - offset)
  try {
    readSync(fd, buf, 0, buf.length, offset)
  } finally {
    closeSync(fd)
  }

  const text = buf.toString('utf8')
  const lastNewline = text.lastIndexOf('\n')
  if (lastNewline === -1) return { lines: [], offset }

  const complete = text.slice(0, lastNewline)
  return {
    lines: complete
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean),
    offset: offset + Buffer.byteLength(complete, 'utf8') + 1,
  }
}

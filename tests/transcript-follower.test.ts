import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script module, no type declarations by design.
import { createTranscriptFollower } from '../scripts/lib/transcript-follower.mjs'

/**
 * Every behaviour here fails silently when it is wrong — a lost tail, a skipped
 * resume, a re-pushed transcript — which is exactly why the follower was pulled
 * out of the supervisor and given injected IO. The `flush` cases below cover a
 * bug that shipped unnoticed: the final sweep was a no-op, so every run lost the
 * last lines its agent wrote.
 */

/** A transcript that behaves like a file being appended to. */
function fakeFile(initial = '') {
  let text = initial
  let ino = 1
  return {
    append(...lines: string[]) {
      text += lines.map((l) => l + '\n').join('')
    },
    replace(contents: string) {
      text = contents
      ino += 1 // a client that recreated the file rather than truncating it
    },
    truncate(contents: string) {
      text = contents
    },
    stat: () => ({ size: text.length, ino }),
    read: (offset: number) => {
      const rest = text.slice(offset)
      const lastNewline = rest.lastIndexOf('\n')
      if (lastNewline === -1) return { lines: [], offset }
      const complete = rest.slice(0, lastNewline)
      return {
        lines: complete.split('\n').filter((l) => l.length > 0),
        offset: offset + complete.length + 1,
      }
    },
  }
}

/** Records what reached the server, and can be told to fail. */
function fakeServer() {
  const batches: { lines: string[]; seq: number }[] = []
  let failNext = 0
  return {
    batches,
    lines: () => batches.flatMap((b) => b.lines),
    failOnce() {
      failNext = 1
    },
    push: async (lines: string[], seq: number) => {
      if (failNext > 0) {
        failNext -= 1
        throw new Error('server said no')
      }
      batches.push({ lines, seq })
    },
  }
}

describe('createTranscriptFollower', () => {
  it('pushes whole lines and leaves a partial one for the next pass', async () => {
    const file = fakeFile('a\nb\nhalf-writt')
    const server = fakeServer()
    const f = createTranscriptFollower({ ...file, push: server.push })

    await f.tick()
    expect(server.lines()).toEqual(['a', 'b'])

    file.append('en')
    await f.tick()
    expect(server.lines()).toEqual(['a', 'b', 'half-written'])
  })

  it('tags each batch with an increasing sequence, since the server dedups on it', async () => {
    const file = fakeFile('1\n2\n3\n4\n5\n')
    const server = fakeServer()
    const f = createTranscriptFollower({ ...file, push: server.push, batchSize: 2 })

    await f.tick()
    expect(server.batches.map((b) => b.seq)).toEqual([1, 2, 3])
    expect(server.batches.map((b) => b.lines)).toEqual([['1', '2'], ['3', '4'], ['5']])
  })

  it('resumes from a given offset and sequence without re-pushing what came before', async () => {
    // The second turn on one run id. Starting over would make the server dedup the
    // opening batches into nothing, then re-deliver the earlier turn's lines.
    const file = fakeFile('old-1\nold-2\nnew-1\n')
    const server = fakeServer()
    const f = createTranscriptFollower({
      ...file, push: server.push, offset: 'old-1\nold-2\n'.length, clientSeq: 4,
    })

    await f.tick()
    expect(server.lines()).toEqual(['new-1'])
    expect(server.batches[0].seq).toBe(5)
  })

  it('starts over when the transcript shrinks mid-run', async () => {
    // A client that rewrites its transcript per turn while this is still
    // following. Reading on from the old offset delivers nothing, forever, quietly.
    const file = fakeFile('a\nb\nc\n')
    const server = fakeServer()
    const logs: string[] = []
    const f = createTranscriptFollower({ ...file, push: server.push, log: (m: string) => logs.push(m) })

    await f.tick()
    file.truncate('z\n')
    await f.tick()

    expect(server.lines()).toEqual(['a', 'b', 'c', 'z'])
    expect(logs.join(' ')).toMatch(/shrank/)
  })

  it('does not stall on a file that is not there yet', async () => {
    const server = fakeServer()
    const f = createTranscriptFollower({
      stat: () => ({ size: null, ino: null }),
      read: () => {
        throw new Error('ENOENT')
      },
      push: server.push,
    })

    await expect(f.tick()).resolves.toBeUndefined()
    expect(server.batches).toEqual([])
  })

  describe('flush', () => {
    it('delivers the lines that arrived while a push was in flight', async () => {
      // The bug this replaced: the final sweep cleared its running flag first, so
      // the guard at the top of the sweep made it a no-op and the last lines of
      // every run — usually the interesting ones — were never pushed.
      const file = fakeFile('a\n')
      const server = fakeServer()
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => { release = r })

      const f = createTranscriptFollower({
        ...file,
        push: async (lines: string[], seq: number) => {
          await gate
          return server.push(lines, seq)
        },
      })

      const inFlight = f.tick()
      file.append('b', 'c') // written while the first push is stuck
      const flushed = f.flush()
      release()
      await Promise.all([inFlight, flushed])

      expect(server.lines()).toEqual(['a', 'b', 'c'])
    })

    it('delivers the tail even when nothing was in flight', async () => {
      const file = fakeFile('a\nb\n')
      const server = fakeServer()
      const f = createTranscriptFollower({ ...file, push: server.push })

      await f.flush()
      expect(server.lines()).toEqual(['a', 'b'])
    })

    it('stops accepting work afterwards, so a stray poll cannot double-push', async () => {
      const file = fakeFile('a\n')
      const server = fakeServer()
      const f = createTranscriptFollower({ ...file, push: server.push })

      await f.flush()
      file.append('b')
      await f.tick()

      expect(server.lines()).toEqual(['a'])
    })

    it('records the final position, so the next turn resumes from the end', async () => {
      const file = fakeFile('a\nb\n')
      const server = fakeServer()
      const saved: any[] = []
      const f = createTranscriptFollower({ ...file, push: server.push, persist: (p: any) => saved.push(p) })

      await f.flush()
      expect(saved.at(-1)).toMatchObject({ offset: 4, clientSeq: 1, size: 4, ino: 1 })
    })
  })

  describe('when the server rejects a batch', () => {
    it('rewinds so the lines are retried rather than lost', async () => {
      // Advancing past a batch that never landed drops those lines permanently,
      // and nothing anywhere reports it.
      const file = fakeFile('a\nb\n')
      const server = fakeServer()
      const f = createTranscriptFollower({ ...file, push: server.push })

      server.failOnce()
      await f.tick()
      expect(server.lines()).toEqual([])

      await f.tick()
      expect(server.lines()).toEqual(['a', 'b'])
    })

    it('rewinds the sequence too, so a batch that did land is refused as a duplicate', async () => {
      // The retry re-sends every batch of the read, including ones the server
      // already wrote. Reusing their sequence numbers is what makes the server
      // drop them as duplicates instead of appending them twice.
      const file = fakeFile('1\n2\n3\n4\n')
      const server = fakeServer()
      const seen: number[] = []
      const f = createTranscriptFollower({
        ...file,
        batchSize: 2,
        push: async (lines: string[], seq: number) => {
          seen.push(seq)
          if (seen.length === 2) throw new Error('server said no')
          return server.push(lines, seq)
        },
      })

      await f.tick()
      await f.tick()

      // 1, 2 (failed), then 1 again — the same tag the server already has — and 2.
      expect(seen).toEqual([1, 2, 1, 2])
    })

    it('does not record a position it did not reach', async () => {
      const file = fakeFile('a\n')
      const server = fakeServer()
      const saved: any[] = []
      const f = createTranscriptFollower({ ...file, push: server.push, persist: (p: any) => saved.push(p) })

      server.failOnce()
      await f.tick()
      expect(saved).toEqual([])
      expect(f.position()).toEqual({ offset: 0, clientSeq: 0 })
    })
  })
})

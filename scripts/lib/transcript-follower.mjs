/**
 * Follow a growing NDJSON transcript and push what appears, once each.
 *
 * All IO is injected, because every behaviour here is a thing that fails
 * *silently* when it is wrong — a lost tail, a skipped resume, a re-pushed
 * transcript — and the only way to notice is to test it. The bug that motivated
 * pulling this out of the supervisor is in `flush()` below: the original cleared
 * its running flag before taking its final sweep, so the guard at the top of the
 * sweep turned it into a no-op and every run silently lost the last lines the
 * agent wrote.
 *
 * Deps:
 *   read(offset)     -> { lines, offset }  whole parsed lines from a byte offset
 *   stat()           -> { size, ino }      nulls when the file is absent
 *   push(lines, seq) -> Promise            one batch, tagged with its sequence
 *   persist(pos)     -> void               record the position for a later turn
 *   log(message)     -> void
 */
export function createTranscriptFollower({
  read,
  stat,
  push,
  persist = () => {},
  log = () => {},
  batchSize = 64,
  offset = 0,
  clientSeq = 0,
}) {
  let inFlight = null
  let stopped = false

  async function sweep() {
    try {
      // Truncation, caught on every pass rather than only at startup: a client
      // that rewrites its transcript per turn can do it while this is still
      // following. Reading on from a stale offset would deliver nothing for the
      // rest of the run and report no error at all.
      const { size } = stat()
      if (size !== null && size !== undefined && size < offset) {
        log(`transcript shrank to ${size} bytes — following it from the top`)
        offset = 0
      }

      const next = read(offset)
      if (next.lines.length === 0) return

      const from = offset
      const fromSeq = clientSeq
      offset = next.offset
      try {
        for (let i = 0; i < next.lines.length; i += batchSize) {
          await push(next.lines.slice(i, i + batchSize), ++clientSeq)
        }
      } catch (err) {
        // Rewind both, and rely on the server deduping. Advancing past lines that
        // never landed loses them for good; rewinding the sequence too is what
        // makes the retry safe, since a batch that *did* land is refused as a
        // duplicate on the way back through rather than written twice.
        offset = from
        clientSeq = fromSeq
        throw err
      }
      persist({ offset, clientSeq, ...stat() })
    } catch {
      // The file may not exist yet, or be briefly unavailable mid-rotation, or the
      // server may be restarting. None is worth killing the run over; the next
      // pass retries from the same place.
    }
  }

  /** One pass, or the pass already running — redundant polls are dropped, not queued. */
  function tick() {
    if (stopped) return Promise.resolve()
    if (inFlight) return inFlight
    inFlight = sweep().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    tick,

    /**
     * Drain everything written so far, then stop.
     *
     * Two passes on purpose: the first awaits whatever was mid-flight when the
     * agent died, and only then can the second read the bytes that arrived while
     * that one was in the air. Collapsing this into one pass is how the ending of
     * every run goes missing — and the ending is usually the interesting part.
     */
    async flush() {
      await tick()
      await tick()
      stopped = true
      persist({ offset, clientSeq, ...stat() })
    },

    /** Where it has got to. For the caller's own bookkeeping and for tests. */
    position: () => ({ offset, clientSeq }),
  }
}

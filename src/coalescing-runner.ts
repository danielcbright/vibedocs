/**
 * Coalescing runner — debounce a burst of triggers into one run, and never let
 * two runs overlap.
 *
 * Extracted for one reason: an unbounded fan-out of expensive async work is a
 * memory bug, not a performance nit. The search index rebuild walks every
 * project and holds every markdown file's contents in an array while it builds
 * (~86 MB against a real multi-project root, ~3.2 s to complete). Firing it
 * per file-system event put N walks in flight at once, each with its own copy,
 * and a worktree sweep that emitted 2162 markdown events killed the server on
 * the 4 GB default heap before a single walk finished.
 *
 * Two guarantees, and the second is the one that bounds memory:
 *
 * 1. **Debounce** — `schedule()` restarts a timer, so a burst arriving inside
 *    one window costs one run rather than one run per trigger.
 * 2. **Single-flight** — at most one run exists at any instant. Triggers that
 *    arrive while a run is in flight set a `pending` flag and cause exactly one
 *    trailing run when the current one settles.
 *
 * The trailing run is a correctness requirement, not an optimisation: a walk
 * already underway may have read a file before it changed, so its result cannot
 * be treated as covering events that arrived mid-walk.
 *
 * Errors are routed to `onError` and never reject `schedule()` or leave the
 * runner wedged — a failed run still clears in-flight state and still honours a
 * pending trigger.
 */

/** Default debounce window. Long enough to swallow a git checkout's event
 *  storm, short enough that search freshness after a single save is unnoticeable
 *  next to the multi-second walk it triggers. */
export const DEFAULT_COALESCE_DELAY_MS = 500

export interface CoalescingRunnerOptions {
  /** The work to coalesce. Rejections go to `onError`, never unhandled. */
  run: () => Promise<unknown>
  /** Debounce window in ms. Defaults to `DEFAULT_COALESCE_DELAY_MS`. */
  delayMs?: number
  /** Called with any rejection from `run`. */
  onError?: (err: unknown) => void
}

export interface CoalescingRunner {
  /** Request a run. Restarts the debounce window; never starts a second run. */
  schedule(): void
  /** Resolves once nothing is scheduled, in flight, or pending. */
  settled(): Promise<void>
  /** Drop any scheduled/pending run. Idempotent. A run already in flight is
   *  allowed to finish — it holds no resources we can reclaim by abandoning. */
  cancel(): void
  /** Diagnostics: a run is executing right now. */
  readonly inFlight: boolean
  /** Diagnostics: a trigger arrived mid-run and a trailing run is owed. */
  readonly pending: boolean
}

export function createCoalescingRunner(opts: CoalescingRunnerOptions): CoalescingRunner {
  const delayMs = opts.delayMs ?? DEFAULT_COALESCE_DELAY_MS

  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pending = false
  let cancelled = false
  let waiters: Array<() => void> = []

  function isIdle(): boolean {
    return timer === null && !running && !pending
  }

  function releaseWaitersIfIdle(): void {
    if (!isIdle()) return
    const toNotify = waiters
    waiters = []
    for (const w of toNotify) w()
  }

  function launch(): void {
    running = true
    void (async () => {
      try {
        await opts.run()
      } catch (err) {
        opts.onError?.(err)
      } finally {
        running = false
        // A trigger during the run means the finished walk cannot be trusted to
        // cover it. Run exactly once more — not once per trigger.
        if (pending && !cancelled) {
          pending = false
          launch()
        } else {
          pending = false
          releaseWaitersIfIdle()
        }
      }
    })()
  }

  function fire(): void {
    timer = null
    if (cancelled) {
      releaseWaitersIfIdle()
      return
    }
    if (running) {
      pending = true
      return
    }
    launch()
  }

  return {
    schedule() {
      if (cancelled) return
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(fire, delayMs)
    },

    settled() {
      if (isIdle()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },

    cancel() {
      cancelled = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      pending = false
      releaseWaitersIfIdle()
    },

    get inFlight() {
      return running
    },

    get pending() {
      return pending
    },
  }
}

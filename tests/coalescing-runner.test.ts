import { describe, it, expect } from 'vitest'
import {
  createCoalescingRunner,
  DEFAULT_COALESCE_DELAY_MS,
} from '../src/coalescing-runner.js'

/**
 * The runner exists to bound memory, so the load-bearing assertion in this file
 * is `maxConcurrent === 1`. Everything else is about not losing a trigger while
 * enforcing that bound.
 */

function tracker(durationMs = 5) {
  let concurrent = 0
  const stats = { started: 0, completed: 0, maxConcurrent: 0 }
  const run = async () => {
    concurrent += 1
    stats.started += 1
    stats.maxConcurrent = Math.max(stats.maxConcurrent, concurrent)
    await new Promise((r) => setTimeout(r, durationMs))
    concurrent -= 1
    stats.completed += 1
  }
  return { run, stats }
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('createCoalescingRunner — single-flight bound', () => {
  it('never overlaps runs, however many triggers arrive', async () => {
    const { run, stats } = tracker(20)
    const runner = createCoalescingRunner({ run, delayMs: 1 })

    for (let i = 0; i < 200; i++) {
      runner.schedule()
      if (i % 20 === 0) await tick(3) // let some timers actually fire mid-burst
    }
    await runner.settled()

    expect(stats.maxConcurrent).toBe(1)
    expect(runner.inFlight).toBe(false)
    expect(runner.pending).toBe(false)
  })

  it('collapses a same-window burst into a single run', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 20 })

    for (let i = 0; i < 100; i++) runner.schedule()
    await runner.settled()

    expect(stats.started).toBe(1)
    expect(stats.completed).toBe(1)
  })

  it('runs exactly once more when a trigger lands mid-run — not once per trigger', async () => {
    const { run, stats } = tracker(40)
    const runner = createCoalescingRunner({ run, delayMs: 1 })

    runner.schedule()
    await tick(10)
    expect(runner.inFlight).toBe(true)

    for (let i = 0; i < 10; i++) runner.schedule()
    await tick(10)
    expect(runner.pending).toBe(true)

    await runner.settled()
    expect(stats.started).toBe(2)
    expect(stats.maxConcurrent).toBe(1)
  })
})

describe('createCoalescingRunner — scheduling semantics', () => {
  it('debounces: a later trigger pushes the run back', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 30 })

    runner.schedule()
    await tick(20)
    runner.schedule() // resets the window before the first would have fired
    await tick(20)
    expect(stats.started).toBe(0)

    await runner.settled()
    expect(stats.started).toBe(1)
  })

  it('settled() resolves immediately when idle', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 1 })
    await runner.settled()
    expect(stats.started).toBe(0)
  })

  it('runs again for a trigger that arrives after everything settled', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 1 })

    runner.schedule()
    await runner.settled()
    runner.schedule()
    await runner.settled()

    expect(stats.started).toBe(2)
  })

  it('defaults to DEFAULT_COALESCE_DELAY_MS when no delay is given', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run })
    runner.schedule()
    await tick(Math.floor(DEFAULT_COALESCE_DELAY_MS / 2))
    expect(stats.started).toBe(0) // still inside the default window
    runner.cancel()
  })
})

describe('createCoalescingRunner — failure and cancellation', () => {
  it('routes a rejection to onError and stays usable', async () => {
    const errors: unknown[] = []
    let calls = 0
    const runner = createCoalescingRunner({
      delayMs: 1,
      run: async () => {
        calls += 1
        if (calls === 1) throw new Error('walk exploded')
      },
      onError: (e) => errors.push(e),
    })

    runner.schedule()
    await runner.settled()
    expect(errors).toHaveLength(1)
    expect((errors[0] as Error).message).toBe('walk exploded')

    // A failed run must not wedge the runner.
    runner.schedule()
    await runner.settled()
    expect(calls).toBe(2)
    expect(errors).toHaveLength(1)
  })

  it('honours a pending trigger even when the in-flight run rejects', async () => {
    let calls = 0
    const runner = createCoalescingRunner({
      delayMs: 1,
      run: async () => {
        calls += 1
        await tick(20)
        throw new Error('always fails')
      },
      onError: () => {},
    })

    runner.schedule()
    await tick(10)
    runner.schedule() // lands mid-run
    await runner.settled()

    expect(calls).toBe(2)
  })

  it('cancel() drops a scheduled run', async () => {
    const { run, stats } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 20 })

    runner.schedule()
    runner.cancel()
    await tick(50)

    expect(stats.started).toBe(0)
  })

  it('cancel() drops an owed trailing run and ignores later schedules', async () => {
    const { run, stats } = tracker(30)
    const runner = createCoalescingRunner({ run, delayMs: 1 })

    runner.schedule()
    await tick(10)
    runner.schedule()
    await tick(5) // schedule() only arms the timer; pending is set when it fires
    expect(runner.pending).toBe(true)

    runner.cancel()
    await runner.settled() // waits out the in-flight run
    runner.schedule() // must be ignored after cancel
    await tick(30)

    expect(stats.started).toBe(1)
    expect(stats.completed).toBe(1)
  })

  it('cancel() is idempotent and settles waiters', async () => {
    const { run } = tracker()
    const runner = createCoalescingRunner({ run, delayMs: 50 })
    runner.schedule()
    const settled = runner.settled()
    runner.cancel()
    runner.cancel()
    await settled // must not hang
    expect(runner.inFlight).toBe(false)
  })
})

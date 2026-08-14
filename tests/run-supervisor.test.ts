import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script module, no type declarations by design.
import { mapExitToStatus, DEFAULT_EXIT_MAP, planSupervision, selectStopCommand, planReap, planStopAction, planFollowResume } from '../scripts/lib/supervisor-plan.mjs'

/**
 * The supervisor exists so a run is never stranded in a non-terminal state when
 * whoever started it goes away. The mapping below is the contract: it decides
 * what a dead process *meant*, and getting it wrong mislabels finished work.
 */
describe('mapExitToStatus', () => {
  it('maps a clean exit to waiting, NOT done', () => {
    // `done` must stay a deliberate signal that work landed. A finished turn
    // whose PR is still open is exactly the "waiting" state: turn over, work not
    // landed. Auto-setting `done` on exit 0 would make every finished turn look
    // shipped.
    expect(mapExitToStatus({ code: 0 }).status).toBe('waiting')
  })

  it('maps a failing exit to failed', () => {
    expect(mapExitToStatus({ code: 1 }).status).toBe('failed')
    expect(mapExitToStatus({ code: 3 }).status).toBe('failed')
  })

  it('maps the timeout code to failed and says so in the description', () => {
    const r = mapExitToStatus({ code: 124 })
    expect(r.status).toBe('failed')
    expect(r.description.toLowerCase()).toContain('timed out')
  })

  it('maps a needs-a-human code to blocked', () => {
    // Distinct from `failed`: nothing is wrong with the work, it cannot proceed
    // without a person. Surfacing it as failed would bury it.
    expect(mapExitToStatus({ code: 2 }).status).toBe('blocked')
  })

  it('reports stopped when a stop was requested, whatever the exit code', () => {
    // A deliberate stop kills the child, which then exits non-zero. Without the
    // stop signal that reads as a crash, so every intentional stop would be
    // mislabelled `failed`.
    expect(mapExitToStatus({ code: 143, stopRequested: true }).status).toBe('stopped')
    expect(mapExitToStatus({ code: 1, stopRequested: true }).status).toBe('stopped')
    expect(mapExitToStatus({ code: 0, stopRequested: true }).status).toBe('stopped')
  })

  it('reports failed with the signal named when the process was signalled', () => {
    const r = mapExitToStatus({ code: null, signal: 'SIGKILL' })
    expect(r.status).toBe('failed')
    expect(r.description).toContain('SIGKILL')
  })

  it('never returns done for any input', () => {
    const inputs = [
      { code: 0 }, { code: 1 }, { code: 2 }, { code: 124 }, { code: 143 },
      { code: null, signal: 'SIGTERM' }, { code: 0, stopRequested: true },
    ]
    for (const i of inputs) expect(mapExitToStatus(i).status).not.toBe('done')
  })

  it('always produces a non-empty description, so a closed run says why', () => {
    for (const code of [0, 1, 2, 124]) {
      expect(mapExitToStatus({ code }).description.length).toBeGreaterThan(0)
    }
  })

  it('lets a caller override the map for a client with different exit codes', () => {
    // Exit codes are client conventions, not universals — a supervisor wrapping
    // some other agent must be able to say what its codes mean.
    const r = mapExitToStatus({ code: 7 }, { ...DEFAULT_EXIT_MAP, 7: 'blocked' })
    expect(r.status).toBe('blocked')
  })
})

describe('planSupervision', () => {
  const env = { VIBEDOCS_RUNS_TOKEN: 's3cret' }
  const plan = (argv: string[], e = env) => planSupervision(argv, e)

  it('never parses the wrapped command\'s own flags as supervisor options', () => {
    // The whole point of `--`: the child is an agent CLI with flags that collide
    // with ours (--format, --url). A naive argv.indexOf() would read the child's
    // --format as the run's adapter name and silently register the wrong format.
    const p = plan([
      '--id', 'lane-a', '--format', 'cursor-stream-json',
      '--', 'some-agent', '-p', 'brief', '--format', 'text', '--url', 'http://elsewhere',
    ])
    expect(p.ok).toBe(true)
    expect(p.value.format).toBe('cursor-stream-json')
    expect(p.value.url).toBe('http://localhost:8080')
    expect(p.value.command).toEqual([
      'some-agent', '-p', 'brief', '--format', 'text', '--url', 'http://elsewhere',
    ])
  })

  it('requires a run id', () => {
    const p = plan(['--', 'echo', 'hi'])
    expect(p.ok).toBe(false)
    expect(p.error).toMatch(/--id/)
  })

  it('requires a command after the -- separator', () => {
    expect(plan(['--id', 'x']).ok).toBe(false)
    expect(plan(['--id', 'x', '--']).ok).toBe(false)
    expect(plan(['--id', 'x', '--']).error).toMatch(/--/)
  })

  it('requires the ingest token, because registering the run needs it', () => {
    const p = plan(['--id', 'x', '--', 'echo'], {})
    expect(p.ok).toBe(false)
    expect(p.error).toMatch(/VIBEDOCS_RUNS_TOKEN/)
  })

  it('defaults title to the id and strips a trailing slash from the url', () => {
    const p = plan(['--id', 'lane-a', '--url', 'http://host:9/', '--', 'echo'])
    expect(p.value.title).toBe('lane-a')
    expect(p.value.url).toBe('http://host:9')
  })

  it('passes through the optional metadata a rail needs', () => {
    const p = plan([
      '--id', 'lane-a', '--title', 'Refactor the widget', '--project', 'web-app',
      '--workdir', '/w', '--transcript', '/w/events.ndjson', '--', 'echo',
    ])
    expect(p.value).toMatchObject({
      title: 'Refactor the widget', project: 'web-app',
      workdir: '/w', transcript: '/w/events.ndjson',
    })
  })

  it('has no transcript by default, so streaming is opt-in', () => {
    // A supervisor is useful for lifecycle alone; a client that has no
    // transcript file should not be forced to invent one.
    expect(plan(['--id', 'x', '--', 'echo']).value.transcript).toBeUndefined()
    expect(plan(['--id', 'x', '--', 'echo']).value.followPath).toBeUndefined()
  })

  it('follows whichever of --transcript or --capture named the file', () => {
    // One derived path, so the two flags cannot disagree downstream about which
    // file is being tailed.
    expect(plan(['--id', 'x', '--transcript', '/w/a.ndjson', '--', 'echo']).value.followPath)
      .toBe('/w/a.ndjson')
    expect(plan(['--id', 'x', '--capture', '/w/b.ndjson', '--', 'echo']).value.followPath)
      .toBe('/w/b.ndjson')
  })

  it('rejects --transcript and --capture together rather than silently picking one', () => {
    // --capture *writes* the file the follower reads, so with both set one of them
    // is ignored. Failing loudly beats streaming the wrong file.
    const p = plan(['--id', 'x', '--transcript', '/w/a', '--capture', '/w/b', '--', 'echo'])
    expect(p.ok).toBe(false)
    expect(p.error).toMatch(/mutually exclusive/)
  })

  it('takes the stop command as one opaque string', () => {
    // The supervisor must never learn how a client organises its processes, so
    // this is passed through verbatim — shell syntax and all.
    const p = plan(['--id', 'x', '--stop-command', 'kill -TERM -- -$(cat pgid)', '--', 'echo'])
    expect(p.value.stopCommand).toBe('kill -TERM -- -$(cat pgid)')
    expect(plan(['--id', 'x', '--', 'echo']).value.stopCommand).toBeUndefined()
  })

  it('does not read a --capture or --stop-command belonging to the child', () => {
    const p = plan(['--id', 'x', '--', 'agent', '--capture', 'theirs', '--stop-command', 'theirs'])
    expect(p.value.capture).toBeUndefined()
    expect(p.value.stopCommand).toBeUndefined()
  })
})

describe('planStopAction', () => {
  it('signals its own child when no stop command was given', () => {
    const a = planStopAction({ stopCommand: undefined })
    expect(a).toMatchObject({ mechanism: 'signal', signalNow: true, killAfterGrace: true, ack: true, stopHolds: true })
  })

  it('never signals the child when a stop command is delegating the kill', () => {
    // The flag exists because this process holds the wrong pid — an intermediate
    // shell, not the agent. Signalling it reaps the wrapper and orphans the agent.
    for (const delegateExit of [0, 1, null]) {
      expect(planStopAction({ stopCommand: 'stop-me', delegateExit }).signalNow).toBe(false)
    }
  })

  it('acks a delegated stop that succeeded, and still escalates if the child lingers', () => {
    // A successful stop asserts the agent is gone, so a child still alive after
    // the grace window is a leftover wrapper: killing it claims nothing false,
    // and stop has to actually stop.
    const a = planStopAction({ stopCommand: 'stop-me', delegateExit: 0 })
    expect(a).toMatchObject({ mechanism: 'delegated', ack: true, stopHolds: true, killAfterGrace: true })
  })

  it('claims nothing when the delegated stop failed', () => {
    // The whole point. A failed stop asserts nothing, so the agent is probably
    // still working: killing the wrapper would close the run as `stopped` over a
    // live agent, which is the lie this flag exists to remove.
    for (const delegateExit of [1, 127, null]) {
      const a = planStopAction({ stopCommand: 'stop-me', delegateExit })
      expect(a.killAfterGrace).toBe(false)
      // Unacked on purpose: it is the operator's only evidence nothing honoured it.
      expect(a.ack).toBe(false)
      // And the run reports whatever it really reaches, not `stopped`.
      expect(a.stopHolds).toBe(false)
    }
  })

  it('says why in every note, since a failed note is the log line an operator reads', () => {
    expect(planStopAction({ stopCommand: 'x', delegateExit: 127 }).note).toContain('127')
    expect(planStopAction({ stopCommand: 'x', delegateExit: null }).note.length).toBeGreaterThan(0)
    expect(planStopAction({ stopCommand: undefined }).note.length).toBeGreaterThan(0)
  })
})

describe('planFollowResume', () => {
  const file = { path: '/w/events.ndjson', size: 500, ino: 42 }
  const prior = { path: '/w/events.ndjson', offset: 500, size: 500, ino: 42, clientSeq: 7 }

  it('starts at the top when there is no prior record', () => {
    expect(planFollowResume(null, file).offset).toBe(0)
    expect(planFollowResume({}, file).offset).toBe(0)
    expect(planFollowResume({ offset: 0 }, file).offset).toBe(0)
  })

  it('resumes where the previous turn stopped', () => {
    // Without this a second turn re-reads from byte 0: the server dedups the
    // opening batches into nothing, then the counter passes the stored value and
    // the earlier turn's lines arrive again as new events.
    expect(planFollowResume(prior, { ...file, size: 900 }).offset).toBe(500)
  })

  it('starts over when the transcript is gone', () => {
    // An offset into a file that does not exist is not a position — whatever
    // appears at that path next is a different file.
    expect(planFollowResume(prior, { path: file.path, size: null, ino: null }).offset).toBe(0)
    expect(planFollowResume(prior, { path: file.path }).offset).toBe(0)
  })

  it('starts over when the transcript shrank', () => {
    // A client that rewrites its transcript per turn. Reading on from the old
    // offset would deliver nothing at all, and say nothing about it.
    expect(planFollowResume(prior, { ...file, size: 120 }).offset).toBe(0)
  })

  it('starts over when the file was replaced, even though it is now longer', () => {
    // The case a size comparison cannot catch: recreated, then grown past the old
    // length before anyone looked.
    expect(planFollowResume(prior, { ...file, size: 900, ino: 43 }).offset).toBe(0)
  })

  it('starts over when the path itself changed', () => {
    expect(planFollowResume(prior, { ...file, path: '/w/other.ndjson', size: 900 }).offset).toBe(0)
  })

  it('falls back to the offset when no size was recorded', () => {
    const old = { path: file.path, offset: 500, ino: 42 }
    expect(planFollowResume(old, { ...file, size: 900 }).offset).toBe(500)
    expect(planFollowResume(old, { ...file, size: 120 }).offset).toBe(0)
  })

  it('tolerates a sidecar written before inodes were recorded', () => {
    const old = { path: file.path, offset: 500, size: 500 }
    expect(planFollowResume(old, { ...file, size: 900 }).offset).toBe(500)
  })

  it('always explains the decision, because both answers are silent in effect', () => {
    expect(planFollowResume(prior, { ...file, size: 900 }).reason.length).toBeGreaterThan(0)
    expect(planFollowResume(prior, { ...file, size: 1 }).reason.length).toBeGreaterThan(0)
    expect(planFollowResume(null, file).reason.length).toBeGreaterThan(0)
  })
})

describe('selectStopCommand', () => {
  it('returns nothing when the queue is empty', () => {
    expect(selectStopCommand([])).toBeNull()
    expect(selectStopCommand(undefined)).toBeNull()
  })

  it('picks the stop command to act on', () => {
    const cmd = { id: 'c1', kind: 'stop', createdAt: 1 }
    expect(selectStopCommand([cmd])).toEqual(cmd)
  })

  it('acts on the oldest stop when several are queued', () => {
    // Several presses of the button queue several commands. Acting on the oldest
    // and acking it keeps the queue draining in order rather than stranding one.
    const a = { id: 'a', kind: 'stop', createdAt: 10 }
    const b = { id: 'b', kind: 'stop', createdAt: 20 }
    expect(selectStopCommand([b, a]).id).toBe('a')
  })

  it('ignores kinds it does not understand', () => {
    // The server's vocabulary is closed to `stop` today. If it ever grows, an old
    // supervisor must not act on a command whose meaning it does not know —
    // acting-then-acking would silently consume it.
    expect(selectStopCommand([{ id: 'x', kind: 'restart', createdAt: 1 }])).toBeNull()
    const stop = { id: 's', kind: 'stop', createdAt: 2 }
    expect(selectStopCommand([{ id: 'x', kind: 'restart', createdAt: 1 }, stop])).toEqual(stop)
  })

  it('skips commands already acked', () => {
    expect(selectStopCommand([{ id: 'a', kind: 'stop', createdAt: 1, ackedAt: 99 }])).toBeNull()
  })
})

describe('planReap', () => {
  const alive = (pid: number) => pid === 111 // 111 is running, everything else is gone

  it('never reaps a run that already reached a terminal status', () => {
    const entries = [
      { id: 'a', status: 'done', supervisorPid: 222 },
      { id: 'b', status: 'failed', supervisorPid: 222 },
      { id: 'c', status: 'stopped', supervisorPid: 222 },
    ]
    expect(planReap(entries, alive)).toEqual([])
  })

  it('reaps a non-terminal run whose supervisor is gone', () => {
    const plan = planReap([{ id: 'a', status: 'running', supervisorPid: 222 }], alive)
    expect(plan).toHaveLength(1)
    expect(plan[0].id).toBe('a')
    expect(plan[0].reason).toMatch(/supervisor/i)
  })

  it('leaves a run alone while its supervisor is still alive', () => {
    expect(planReap([{ id: 'a', status: 'running', supervisorPid: 111 }], alive)).toEqual([])
  })

  it('never reaps a run it has no supervisor record for', () => {
    // This is the important restraint. A run with no local sidecar might be
    // driven by a client on another machine, where local PID liveness says
    // nothing. Reaping it would mark someone else's healthy run as failed.
    expect(planReap([{ id: 'a', status: 'running', supervisorPid: null }], alive)).toEqual([])
    expect(planReap([{ id: 'a', status: 'running' }], alive)).toEqual([])
  })

  it('reaps every non-terminal status, not just running', () => {
    const entries = ['running', 'idle', 'blocked', 'waiting'].map((status, i) => ({
      id: `r${i}`, status, supervisorPid: 222,
    }))
    expect(planReap(entries, alive).map((r) => r.id)).toEqual(['r0', 'r1', 'r2', 'r3'])
  })

  it('ignores a sidecar recorded on another host', () => {
    // A PID is only meaningful on the machine that issued it; the same number is
    // very likely a live, unrelated process here.
    const entries = [{ id: 'a', status: 'running', supervisorPid: 222, host: 'someone-else' }]
    expect(planReap(entries, alive, { host: 'this-box' })).toEqual([])
    expect(planReap([{ ...entries[0], host: 'this-box' }], alive, { host: 'this-box' })).toHaveLength(1)
  })
})

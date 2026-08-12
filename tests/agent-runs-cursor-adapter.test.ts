import { describe, it, expect } from 'vitest'
import { cursorStreamJsonAdapter as adapter } from '../src/agent-runs/formats/cursor-stream-json.js'
import { getAdapter } from '../src/agent-runs/formats/index.js'
import { MAX_TOOL_OUTPUT_BYTES } from '../src/shared/agent-run-types.js'
import * as F from './agent-runs-fixtures.js'

const FIXED_NOW = 1_800_000_000_000
const ctx = { now: () => FIXED_NOW }

function run(raw: unknown[], state = adapter.createState()) {
  return adapter.normalize(raw, state, ctx)
}
function appends(recs: ReturnType<typeof adapter.normalize>) {
  return recs.filter((r): r is Extract<typeof r, { op: 'append' }> => r.op === 'append')
}

describe('cursor-stream-json adapter', () => {
  it('is registered under its wire name', () => {
    expect(getAdapter('cursor-stream-json')).toBe(adapter)
    expect(getAdapter('nope')).toBeNull()
  })

  it('server-stamps every event the vendor left without a timestamp', () => {
    const evs = appends(run([F.INIT_NO_TS, F.USER_NO_TS])).map((r) => r.event)
    expect(evs.map((e) => e.kind)).toEqual(['init', 'user'])
    for (const e of evs) expect(e.ts).toBe(FIXED_NOW)
  })

  it('splits the embedded newline out of call_id so the two phases pair', () => {
    const recs = run([F.SHELL_STARTED, F.SHELL_COMPLETED_OK])
    const started = appends(recs)[0].event
    expect(started.tool!.callId).toBe('call_AbCdEf123456')
    expect(started.tool!.callId).not.toContain('\n')
    expect(recs[1]).toMatchObject({ op: 'patch', callId: 'call_AbCdEf123456' })
  })

  it('appends a running tool on started and patches it on completed', () => {
    const recs = run([F.SHELL_STARTED, F.SHELL_COMPLETED_OK])
    expect(recs).toHaveLength(2)
    expect(appends(recs)[0].event).toMatchObject({
      kind: 'tool',
      tool: { name: 'shell', label: 'npm test', status: 'running' },
    })
    const patch = recs[1] as Extract<(typeof recs)[number], { op: 'patch' }>
    expect(patch.patch.tool).toMatchObject({
      status: 'success', exitCode: 0, output: '5 passing\n', endTs: 1_700_000_004_000,
    })
  })

  it('reads the failure discriminator and keeps exitCode, stderr and command', () => {
    const recs = run([F.SHELL_STARTED_FAILURE, F.SHELL_COMPLETED_FAILURE])
    const patch = recs.find((r) => r.op === 'patch') as any
    expect(patch.patch.tool).toMatchObject({
      status: 'error',
      exitCode: 1,
      output: 'error TS2304: Cannot find name "foo".\n',
    })
  })

  it('marks a nonzero exitCode inside a success body as an error', () => {
    const weird = structuredClone(F.SHELL_COMPLETED_OK) as any
    weird.tool_call.shellToolCall.result.success.exitCode = 2
    const recs = run([F.SHELL_STARTED, weird])
    const patch = recs.find((r) => r.op === 'patch') as any
    expect(patch.patch.tool.status).toBe('error')
    expect(patch.patch.tool.exitCode).toBe(2)
  })

  it('drops the shell parsing AST from args', () => {
    const args = appends(run([F.SHELL_STARTED]))[0].event.tool!.args
    expect(args).toEqual({ command: 'npm test', workingDirectory: '/home/dev/app' })
    expect(JSON.stringify(args)).not.toContain('executableCommands')
  })

  it('pairs across batch boundaries using carried state', () => {
    const state = adapter.createState()
    const first = adapter.normalize([F.SHELL_STARTED], state, ctx)
    const second = adapter.normalize([F.SHELL_COMPLETED_OK], state, ctx)
    expect(first).toHaveLength(1)
    expect(first[0].op).toBe('append')
    expect(second).toMatchObject([{ op: 'patch', callId: 'call_AbCdEf123456' }])
  })

  it('appends a complete event when a completion arrives with no matching started', () => {
    // Happens after a restart drops in-memory adapter state.
    const recs = run([F.SHELL_COMPLETED_OK])
    expect(recs).toHaveLength(1)
    expect(recs[0].op).toBe('append')
    expect(appends(recs)[0].event.tool).toMatchObject({ status: 'success', exitCode: 0 })
  })

  it('coalesces a thinking delta run into one event at the terminator', () => {
    const evs = appends(run(F.THINKING_DELTAS)).map((r) => r.event)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ kind: 'thinking', text: '**Reading** the router setup' })
    expect(evs[0].ts).toBe(1_700_000_001_000) // first delta's ts, not the terminator's
  })

  it('flushes buffered thinking when a different event kind interrupts it', () => {
    const recs = run([...F.THINKING_DELTAS.slice(0, 2), F.ASSISTANT_MD])
    expect(appends(recs).map((r) => r.event.kind)).toEqual(['thinking', 'assistant'])
  })

  it('coalesces a burst that spans two batches into a single event', () => {
    const state = adapter.createState()
    const a = adapter.normalize([F.THINKING_DELTAS[0]], state, ctx)
    const b = adapter.normalize([F.THINKING_DELTAS[1], F.THINKING_DELTAS[2]], state, ctx)
    expect(a).toHaveLength(0) // still buffering — nothing emitted yet
    expect(appends(b).map((r) => r.event.text)).toEqual(['**Reading** the router setup'])
  })

  it('keeps assistant markdown verbatim for the server-side renderer', () => {
    const evs = appends(run([F.ASSISTANT_MD])).map((r) => r.event)
    expect(evs[0].text).toBe('## Plan\n\n- read `router.ts`\n- **add** the route')
  })

  it('carries init identity and result usage into meta', () => {
    const [init, result] = appends(run([F.INIT_NO_TS, F.RESULT_NO_TS])).map((r) => r.event)
    expect(init.meta).toMatchObject({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', model: 'Auto Cost', cwd: '/home/dev/app' })
    expect(result.meta).toMatchObject({ durationMs: 1_491_836, inputTokens: 10367, outputTokens: 3083, isError: false })
  })

  it('emits a result event even when a resumed turn has an empty body', () => {
    const ev = appends(run([F.RESULT_EMPTY_BODY]))[0].event
    expect(ev.kind).toBe('result')
    expect(ev.text).toBe('')
    expect(ev.meta).toMatchObject({ durationMs: 4200 })
  })

  it('handles several result events in one run', () => {
    const recs = run([F.RESULT_NO_TS, F.ASSISTANT_MD, F.RESULT_EMPTY_BODY])
    expect(appends(recs).filter((r) => r.event.kind === 'result')).toHaveLength(2)
  })

  it('maps connection and retry chatter to kind other, preserving the vendor tags', () => {
    const evs = appends(run(F.CONNECTION_EVENTS)).map((r) => r.event)
    expect(evs.every((e) => e.kind === 'other')).toBe(true)
    expect(evs[0].meta).toMatchObject({ vendorType: 'connection', vendorSubtype: 'reconnecting' })
  })

  it('skips malformed lines instead of throwing the batch away', () => {
    const recs = run([null, 'not an object', 42, {}, { type: 'tool_call', subtype: 'started' }, F.ASSISTANT_MD])
    expect(appends(recs).map((r) => r.event.kind)).toEqual(['assistant'])
  })

  it('caps oversized output and flags the truncation', () => {
    const big = structuredClone(F.SHELL_COMPLETED_OK) as any
    big.tool_call.shellToolCall.result.success.stdout = 'z'.repeat(MAX_TOOL_OUTPUT_BYTES + 5000)
    const tool = appends(run([big]))[0].event.tool!
    expect(tool.output!.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_BYTES + 64)
    expect(tool.outputTruncated).toBe(true)
  })
})

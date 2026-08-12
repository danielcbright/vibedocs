import { describe, it, expect } from 'vitest'
import { applyRecords, type AgentEvent, type EventRecord } from '../src/shared/agent-run-types.js'

function ev(seq: number, over: Partial<AgentEvent> = {}): AgentEvent {
  return { seq, ts: 1000 + seq, kind: 'other', ...over }
}

describe('applyRecords', () => {
  it('appends events in seq order', () => {
    const records: EventRecord[] = [
      { op: 'append', event: ev(1, { kind: 'user', text: 'go' }) },
      { op: 'append', event: ev(2, { kind: 'assistant', text: 'ok' }) },
    ]
    const out = applyRecords([], records)
    expect(out.map((e) => e.seq)).toEqual([1, 2])
    expect(out[0].text).toBe('go')
  })

  it('folds a patch into an earlier event, merging the tool sub-object', () => {
    const records: EventRecord[] = [
      {
        op: 'append',
        event: ev(1, {
          kind: 'tool',
          tool: { name: 'shell', callId: 'c1', label: 'ls', args: {}, status: 'running' },
        }),
      },
      { op: 'append', event: ev(2, { kind: 'assistant', text: 'meanwhile' }) },
      {
        op: 'patch',
        seq: 1,
        patch: { tool: { status: 'success', exitCode: 0, output: 'a\nb', endTs: 2000 } as any },
      },
    ]
    const out = applyRecords([], records)
    expect(out).toHaveLength(2)
    expect(out[0].tool).toMatchObject({
      name: 'shell',      // preserved from the append
      callId: 'c1',       // preserved
      label: 'ls',        // preserved
      status: 'success',  // overwritten
      exitCode: 0,
      output: 'a\nb',
      endTs: 2000,
    })
    expect(out[1].text).toBe('meanwhile') // ordering unaffected by the patch
  })

  it('orders by seq even when records arrive out of order', () => {
    const out = applyRecords([], [
      { op: 'append', event: ev(3, { text: 'third' }) },
      { op: 'append', event: ev(1, { text: 'first' }) },
      { op: 'append', event: ev(2, { text: 'second' }) },
    ])
    expect(out.map((e) => e.text)).toEqual(['first', 'second', 'third'])
  })

  // The property the whole paging design rests on: a client folds page N onto
  // whatever it already had, and must land where a full re-read would.
  it('is incremental: folding a second page onto a prior result matches folding all at once', () => {
    const page1: EventRecord[] = [
      {
        op: 'append',
        event: ev(1, { kind: 'tool', tool: { name: 'shell', callId: 'c1', label: 'ls', args: {}, status: 'running' } }),
      },
    ]
    const page2: EventRecord[] = [{ op: 'patch', seq: 1, patch: { tool: { status: 'success' } as any } }]
    const incremental = applyRecords(applyRecords([], page1), page2)
    const allAtOnce = applyRecords([], [...page1, ...page2])
    expect(incremental).toEqual(allAtOnce)
    expect(incremental[0].tool).toMatchObject({ label: 'ls', status: 'success' })
  })

  it('ignores a patch for an unknown seq rather than throwing', () => {
    // Legitimate: a client paging from a non-zero record offset can receive a
    // patch for an event it has, or — after a reset — one it does not.
    expect(applyRecords([], [{ op: 'patch', seq: 99, patch: { text: 'x' } }])).toEqual([])
  })

  it('does not mutate the events array or the events passed in', () => {
    const prior = applyRecords([], [{ op: 'append', event: ev(1, { text: 'first' }) }])
    const snapshot = JSON.parse(JSON.stringify(prior))
    applyRecords(prior, [{ op: 'patch', seq: 1, patch: { text: 'changed' } }])
    expect(prior).toEqual(snapshot)
  })
})

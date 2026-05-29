import { describe, it, expect } from 'vitest'
import { createInMemoryClientChannel } from '../src/adapters/in-memory-client-channel.js'
import { reloadMessage, refreshTreeMessage } from '../src/shared/ws-messages.js'

describe('InMemoryClientChannel', () => {
  it('records broadcast messages on sent[]', () => {
    const ch = createInMemoryClientChannel()

    ch.broadcast(reloadMessage('alpha/notes.md'))
    ch.broadcast(refreshTreeMessage())

    expect(ch.sent).toEqual([
      { type: 'reload', path: 'alpha/notes.md' },
      { type: 'refresh-tree' },
    ])
  })

  it('preserves message order across many broadcasts', () => {
    const ch = createInMemoryClientChannel()

    for (let i = 0; i < 5; i++) {
      ch.broadcast(reloadMessage(`alpha/p${i}.md`))
    }

    expect(ch.sent.map((m) => (m.type === 'reload' ? m.path : null))).toEqual([
      'alpha/p0.md', 'alpha/p1.md', 'alpha/p2.md', 'alpha/p3.md', 'alpha/p4.md',
    ])
  })

  it('close() prevents further messages from being recorded', async () => {
    const ch = createInMemoryClientChannel()
    ch.broadcast(refreshTreeMessage())
    await ch.close()
    ch.broadcast(reloadMessage('alpha/late.md'))

    expect(ch.sent).toEqual([{ type: 'refresh-tree' }])
  })
})

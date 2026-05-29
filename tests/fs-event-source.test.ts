import { describe, it, expect } from 'vitest'
import { createInMemoryFsEventSource } from '../src/adapters/in-memory-fs-event-source.js'
import type { FsEvent } from '../src/ports/fs-event-source.js'

describe('InMemoryFsEventSource', () => {
  it('delivers emitted events to subscribers synchronously', () => {
    const src = createInMemoryFsEventSource()
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    src.emit({ kind: 'change', path: '/projects/alpha/notes.md' })
    src.emit({ kind: 'add', path: '/projects/alpha/img.png' })

    expect(received).toEqual([
      { kind: 'change', path: '/projects/alpha/notes.md' },
      { kind: 'add', path: '/projects/alpha/img.png' },
    ])
  })

  it('fans out a single event to multiple subscribers in subscription order', () => {
    const src = createInMemoryFsEventSource()
    const order: string[] = []
    src.subscribe(() => order.push('a'))
    src.subscribe(() => order.push('b'))
    src.subscribe(() => order.push('c'))

    src.emit({ kind: 'unlink', path: '/projects/alpha/old.md' })

    expect(order).toEqual(['a', 'b', 'c'])
  })

  it('close() prevents further delivery and resolves', async () => {
    const src = createInMemoryFsEventSource()
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    await src.close()
    src.emit({ kind: 'change', path: '/projects/alpha/notes.md' })

    expect(received).toEqual([])
  })

  it('supports every FsEvent kind: add, change, unlink, addDir, unlinkDir', () => {
    const src = createInMemoryFsEventSource()
    const received: FsEvent[] = []
    src.subscribe((ev) => received.push(ev))

    src.emit({ kind: 'add', path: '/p/a.md' })
    src.emit({ kind: 'change', path: '/p/a.md' })
    src.emit({ kind: 'unlink', path: '/p/a.md' })
    src.emit({ kind: 'addDir', path: '/p/sub' })
    src.emit({ kind: 'unlinkDir', path: '/p/sub' })

    expect(received.map((e) => e.kind)).toEqual([
      'add', 'change', 'unlink', 'addDir', 'unlinkDir',
    ])
  })
})

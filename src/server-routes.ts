import type { Hono } from 'hono'
import type { IndexStore } from './search.js'

export function registerSearchRoute(app: Hono, store: IndexStore): void {
  app.get('/api/search', (c) => {
    const q = c.req.query('q') || ''
    if (q.trim().length < 2) {
      return c.json({ data: [], version: store.version })
    }
    const results = store.search(q)
    return c.json({ data: results, version: store.version })
  })
}

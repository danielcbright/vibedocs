import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import {
  VibedocsError,
  httpStatusForCode,
  registerErrorHandler,
} from '../src/errors.js'

describe('VibedocsError', () => {
  it('constructs with a code and message', () => {
    const err = new VibedocsError('not-found', 'File not found')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(VibedocsError)
    expect(err.code).toBe('not-found')
    expect(err.message).toBe('File not found')
    expect(err.name).toBe('VibedocsError')
  })

  it('preserves cause when provided', () => {
    const cause = new Error('underlying fs error')
    ;(cause as any).code = 'ENOENT'
    const err = new VibedocsError('not-found', 'File not found', { cause })
    expect(err.cause).toBe(cause)
  })

  it('accepts every documented code', () => {
    const codes = ['not-found', 'forbidden', 'traversal', 'conflict', 'invalid', 'io'] as const
    for (const code of codes) {
      const err = new VibedocsError(code, 'x')
      expect(err.code).toBe(code)
    }
  })
})

describe('httpStatusForCode', () => {
  it('maps not-found to 404', () => {
    expect(httpStatusForCode('not-found')).toBe(404)
  })
  it('maps forbidden to 403', () => {
    expect(httpStatusForCode('forbidden')).toBe(403)
  })
  it('maps traversal to 400', () => {
    expect(httpStatusForCode('traversal')).toBe(400)
  })
  it('maps conflict to 409', () => {
    expect(httpStatusForCode('conflict')).toBe(409)
  })
  it('maps invalid to 400', () => {
    expect(httpStatusForCode('invalid')).toBe(400)
  })
  it('maps io to 500', () => {
    expect(httpStatusForCode('io')).toBe(500)
  })
})

describe('registerErrorHandler', () => {
  function appWithRoute(throwFn: () => never): Hono {
    const app = new Hono()
    registerErrorHandler(app)
    app.get('/boom', () => {
      throwFn()
    })
    return app
  }

  it('translates VibedocsError(not-found) to 404 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('not-found', 'File not found')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'File not found' })
  })

  it('translates VibedocsError(forbidden) to 403 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('forbidden', 'Forbidden')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Forbidden' })
  })

  it('translates VibedocsError(traversal) to 400 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('traversal', 'Invalid path')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid path' })
  })

  it('translates VibedocsError(conflict) to 409 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('conflict', 'Too many naming conflicts')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Too many naming conflicts' })
  })

  it('translates VibedocsError(invalid) to 400 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('invalid', 'Target is not a directory')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Target is not a directory' })
  })

  it('translates VibedocsError(io) to 500 + JSON body', async () => {
    const app = appWithRoute(() => {
      throw new VibedocsError('io', 'Disk full')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Disk full' })
  })

  it('translates a generic (non-Vibedocs) Error to 500 with a safe body', async () => {
    const app = appWithRoute(() => {
      throw new Error('this should not leak to client')
    })
    const res = await app.request('/boom')
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('Internal Server Error')
    // Internal message should NOT leak
    expect(JSON.stringify(body)).not.toContain('this should not leak to client')
  })
})

import { describe, it, expect } from 'vitest'
import {
  reloadMessage,
  refreshTreeMessage,
  parseWsMessage,
  type WsMessage,
} from '../src/shared/ws-messages.js'

describe('ws-messages', () => {
  describe('reloadMessage', () => {
    it('constructs a typed reload message carrying the file path', () => {
      const msg = reloadMessage('/abs/path/to/file.md')
      expect(msg).toEqual({ type: 'reload', path: '/abs/path/to/file.md' })
    })
  })

  describe('refreshTreeMessage', () => {
    it('constructs a typed refresh-tree message with no payload', () => {
      const msg = refreshTreeMessage()
      expect(msg).toEqual({ type: 'refresh-tree' })
    })
  })

  describe('parseWsMessage (round-trip envelope contract)', () => {
    it('round-trips a reload message through JSON', () => {
      const original: WsMessage = reloadMessage('/x/y.md')
      const wire = JSON.stringify(original)
      const parsed = parseWsMessage(wire)
      expect(parsed).toEqual(original)
    })

    it('round-trips a refresh-tree message through JSON', () => {
      const original: WsMessage = refreshTreeMessage()
      const wire = JSON.stringify(original)
      const parsed = parseWsMessage(wire)
      expect(parsed).toEqual(original)
    })

    it('returns null for invalid JSON', () => {
      expect(parseWsMessage('not json')).toBeNull()
    })

    it('returns null for JSON that does not match any known variant', () => {
      expect(parseWsMessage(JSON.stringify({ type: 'unknown-type' }))).toBeNull()
      expect(parseWsMessage(JSON.stringify({ type: 'reload' }))).toBeNull() // missing path
      expect(parseWsMessage(JSON.stringify({ foo: 'bar' }))).toBeNull()
    })
  })
})

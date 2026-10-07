import { describe, it, expect } from 'vitest'
import { childEnvFor } from '../src/cli/serve-live.js'

/**
 * `vibedocs serve` re-execs the server with the roots it was given. The child must
 * carry exactly one answer to "which roots?" — the --root list — or the server
 * boots warning about a variable the operator never typed on this command.
 */
describe('childEnvFor', () => {
  it('passes the --root list as VIBEDOCS_ROOTS and drops every other roots variable', () => {
    const env = childEnvFor(
      { VIBEDOCS_ROOT: '/old', VIBEDOCS_ROOTS_FILE: '/cfg/roots.txt', VIBEDOCS_ROOTS: '/stale', KEEP: '1' },
      { roots: ['/a', '/b'], port: 9000 },
    )
    expect(env.VIBEDOCS_ROOTS).toBe('/a:/b')
    expect(env.VIBEDOCS_PORT).toBe('9000')
    expect(env).not.toHaveProperty('VIBEDOCS_ROOT')
    expect(env).not.toHaveProperty('VIBEDOCS_ROOTS_FILE')
    expect(env.KEEP).toBe('1')
  })
})

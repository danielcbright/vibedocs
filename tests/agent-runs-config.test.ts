import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { parseAgentRunsEnv, loadAgentRunsClientConfig, compileLinkifyRules } from '../src/agent-runs/config.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'vibedocs-cfg-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

/** The loader reads <dirname(runsDir)>/agent-runs.json, so point runsDir one level down. */
function runsDirIn(base: string) { return path.join(base, 'runs') }

describe('parseAgentRunsEnv', () => {
  it('is disabled by default so upstream users get no extra surface', () => {
    const cfg = parseAgentRunsEnv({}, '/home/dev')
    expect(cfg.enabled).toBe(false)
    expect(cfg.token).toBeNull()
  })

  it('accepts the same truthy spellings as the rest of vibedocs', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE', ' On ']) {
      expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: v }, '/home/dev').enabled).toBe(true)
    }
    for (const v of ['false', '0', 'no', '', 'maybe']) {
      expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: v }, '/home/dev').enabled).toBe(false)
    }
  })

  it('defaults the runs dir under the home directory', () => {
    const cfg = parseAgentRunsEnv({ VIBEDOCS_RUNS_ENABLED: 'true' }, '/home/dev')
    expect(cfg.runsDir).toBe(path.join('/home/dev', '.vibedocs', 'runs'))
  })

  it('honours an explicit runs dir, resolved to an absolute path', () => {
    const cfg = parseAgentRunsEnv({ VIBEDOCS_RUNS_DIR: '/srv/runs' }, '/home/dev')
    expect(cfg.runsDir).toBe('/srv/runs')
    expect(path.isAbsolute(cfg.runsDir)).toBe(true)
  })

  it('treats a blank token as unset', () => {
    expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_TOKEN: '   ' }, '/home/dev').token).toBeNull()
    expect(parseAgentRunsEnv({ VIBEDOCS_RUNS_TOKEN: 's3cret' }, '/home/dev').token).toBe('s3cret')
  })
})

describe('loadAgentRunsClientConfig', () => {
  it('returns empty config when the file is absent', async () => {
    expect(await loadAgentRunsClientConfig(runsDirIn(dir))).toEqual({ linkify: [], editorScheme: null })
  })

  it('reads linkify rules and the editor scheme', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({
      linkify: [{ pattern: '\\b([A-Z]+-\\d+)\\b', url: 'https://tracker.example.com/browse/$1', kind: 'issue' }],
      editorScheme: 'editor://file',
    }))
    const cfg = await loadAgentRunsClientConfig(runsDirIn(dir))
    expect(cfg.editorScheme).toBe('editor://file')
    expect(cfg.linkify).toHaveLength(1)
    expect(cfg.linkify[0].kind).toBe('issue')
  })

  it('degrades to empty config on malformed JSON rather than crashing the server', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), '{ not json')
    expect(await loadAgentRunsClientConfig(runsDirIn(dir))).toEqual({ linkify: [], editorScheme: null })
  })

  it('drops unusable rules instead of accepting them', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({
      linkify: [
        { pattern: '(', url: 'https://x.example.com/$1', kind: 'issue' },    // unparseable regex
        { pattern: 'ok', url: 'javascript:alert(1)', kind: 'issue' },         // unsafe scheme
        { pattern: 'ok2', kind: 'issue' },                                    // no url
        { pattern: 'good', url: 'https://x.example.com/$1', kind: 'weird' },  // bad kind -> 'other'
      ],
    }))
    const cfg = await loadAgentRunsClientConfig(runsDirIn(dir))
    expect(cfg.linkify).toHaveLength(1)
    expect(cfg.linkify[0]).toMatchObject({ pattern: 'good', kind: 'other' })
  })

  it('rejects a dangerous editor scheme', async () => {
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({ editorScheme: 'javascript:x' }))
    expect((await loadAgentRunsClientConfig(runsDirIn(dir))).editorScheme).toBeNull()
  })

  it('caps the rule count so a huge config cannot stall linkification', async () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ pattern: `p${i}`, url: `https://x.example.com/${i}`, kind: 'other' }))
    await writeFile(path.join(dir, 'agent-runs.json'), JSON.stringify({ linkify: many }))
    expect((await loadAgentRunsClientConfig(runsDirIn(dir))).linkify.length).toBeLessThanOrEqual(64)
  })
})

describe('compileLinkifyRules', () => {
  it('compiles patterns to global regexes', () => {
    const compiled = compileLinkifyRules([{ pattern: 'A-\\d+', url: 'https://x.example.com/$1', kind: 'issue' }])
    expect(compiled).toHaveLength(1)
    expect(compiled[0].regex.global).toBe(true)
  })

  it('skips an uncompilable pattern rather than throwing', () => {
    expect(compileLinkifyRules([{ pattern: '(', url: 'https://x.example.com', kind: 'other' }])).toEqual([])
  })
})

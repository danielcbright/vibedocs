import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, realpathSync } from 'fs'
import os from 'os'
import path from 'path'

/**
 * How the macOS installer stages roots (#193).
 *
 * The installer is bash, so its real verification is running it. This pins the one
 * thing that would otherwise be reverted silently: it must name the operator's
 * folders directly with `VIBEDOCS_ROOTS`, not stage symlinks under a directory and
 * point `VIBEDOCS_ROOT` at that.
 *
 * The farm looked equivalent and was not. Its advertised advantage — change the
 * selection by adding or removing a link, no restart — only half worked: a link
 * added after boot was listed and indexed once and then silently stopped receiving
 * file events (measured; see #194). It was also the reason the watcher predicate
 * had to reason about symlink-resolved paths, which grew the watcher to 866,194
 * entries once.
 */

const SCRIPT = readFileSync(
  path.join(import.meta.dirname, '..', 'scripts', 'install-macos.sh'),
  'utf-8',
)

describe('install-macos.sh root staging (#193)', () => {
  it('names the roots file in the plist, with Settings and supervised restart on', () => {
    const plistBlock = SCRIPT.slice(SCRIPT.indexOf('<key>EnvironmentVariables</key>'))
    expect(plistBlock).toMatch(/<key>VIBEDOCS_ROOTS_FILE<\/key>/)
    expect(plistBlock).toMatch(/<key>VIBEDOCS_SETTINGS_ENABLED<\/key><string>true</)
    expect(plistBlock).toMatch(/<key>VIBEDOCS_SUPERVISED<\/key><string>true</)
  })

  it('does not set VIBEDOCS_ROOTS, which would beat the roots file and leave Settings read-only', () => {
    const plistBlock = SCRIPT.slice(SCRIPT.indexOf('<key>EnvironmentVariables</key>'))
    expect(plistBlock).not.toMatch(/<key>VIBEDOCS_ROOTS<\/key>/)
  })

  it('does not set VIBEDOCS_ROOT, which would win over nothing and confuse the boot log', () => {
    // The server prefers VIBEDOCS_ROOTS and warns when both are set. A plist
    // carrying both would make every boot log a warning about a variable the
    // operator never typed.
    const plistBlock = SCRIPT.slice(SCRIPT.indexOf('<key>EnvironmentVariables</key>'))
    expect(plistBlock).not.toMatch(/<key>VIBEDOCS_ROOT<\/key>/)
  })

  it('creates no symlinks', () => {
    // The whole point. `ln -s` anywhere in here means the farm came back.
    expect(SCRIPT).not.toMatch(/\bln -s/)
  })

  it('still cleans up a roots directory left by an earlier install', () => {
    // Previous installs left symlinks in ~/.vibedocs/roots. Leaving them behind
    // is a directory that looks load-bearing and is not.
    expect(SCRIPT).toMatch(/legacy|previous install/i)
  })

  it('keeps the roots file apart from the legacy symlink directory', () => {
    // An upgraded machine can still have ~/.vibedocs/roots as a directory holding
    // what an operator put there by hand; a file of the same name could not be
    // written over it.
    const file = /^ROOTS_FILE="([^"]+)"$/m.exec(SCRIPT)?.[1]
    const legacy = /^LEGACY_ROOTS_DIR="([^"]+)"$/m.exec(SCRIPT)?.[1]
    expect(file).toBeDefined()
    expect(legacy).toBeDefined()
    expect(file).not.toBe(legacy)
  })

  it('starts the picker from the roots a pre-roots-file plist named, and removes that seed on cancel', () => {
    // Without it, upgrading meant re-ticking every folder from an empty tree.
    expect(SCRIPT).toMatch(/plutil -extract EnvironmentVariables\.VIBEDOCS_ROOTS raw/)
    expect(SCRIPT).toMatch(/\[ "\$SEEDED" = "1" \] && rm -f "\$PICK_FILE"/)
  })

  it('no longer offers --root, since there is no staging directory', () => {
    expect(SCRIPT).not.toMatch(/^ {2}--root </m)
  })

  it('still supports the non-interactive form an agent uses', () => {
    expect(SCRIPT).toMatch(/--folders/)
    expect(SCRIPT).toMatch(/--yes/)
  })

  it('shows the server\'s own refusal when the health check fails', () => {
    // A selection with duplicate basenames or nested folders makes the server
    // refuse to boot with a specific reason on stdout. Reprinting that beats
    // reimplementing the rules here, where they would drift from parseRoots.
    expect(SCRIPT).toMatch(/vibedocs\.log/)
    expect(SCRIPT).toMatch(/✖/)
  })
})

/**
 * `--help` prints the script's own header comment. It used to slice a hard-coded
 * line range, so editing the header silently truncated the output — the options
 * list disappeared entirely while `--help` still exited 0.
 */
describe('install-macos.sh --help', () => {
  const help = () =>
    execFileSync('bash', [path.join(import.meta.dirname, '..', 'scripts', 'install-macos.sh'), '--help'], {
      encoding: 'utf-8',
    })

  it('lists every option it accepts', () => {
    const out = help()
    for (const flag of ['--folders', '--port', '--host', '--runs', '--yes', '--dry-run', '--uninstall']) {
      expect(out, `expected --help to document ${flag}`).toContain(flag)
    }
  })

  it('does not document the retired --root flag', () => {
    expect(help()).not.toMatch(/^ {2}--root </m)
  })

  it('survives the header changing length', () => {
    // The whole header is comment lines; the last of them must reach the output.
    const out = help()
    expect(out).toContain('Options:')
    expect(out.trimEnd().split('\n').at(-1)).toMatch(/--uninstall/)
  })
})

/**
 * The installer run for real, with `--dry-run` so nothing is written: no plist, no
 * roots file, no launchctl. HOME is a scratch directory, so even a regression that
 * ignored the flag could not reach the developer's own LaunchAgent.
 *
 * The interactive path hands the choice to `vibedocs pick-roots`, which
 * tests/cli-pick-roots.test.ts drives over a real socket.
 */
describe('install-macos.sh --dry-run --folders', () => {
  let home: string
  const run = (...args: string[]) =>
    execFileSync('bash', [path.join(import.meta.dirname, '..', 'scripts', 'install-macos.sh'), '--dry-run', ...args], {
      encoding: 'utf-8',
      env: { ...process.env, HOME: home },
    })

  beforeEach(() => {
    home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'vibedocs-install-')))
    for (const d of ['src/work/repo', 'ops', 'Work: Archive']) mkdirSync(path.join(home, d), { recursive: true })
  })
  afterEach(() => {
    rmSync(home, { recursive: true, force: true })
  })

  it('takes a nested folder below the top level of home', () => {
    const out = run('--folders', 'src/work,ops', '--yes')
    const rootsSection = out.slice(out.indexOf(`${home}/.vibedocs/roots.txt:`), out.indexOf('.plist:'))
    expect(rootsSection).toContain(`  ${home}/src/work\n`)
    expect(rootsSection).toContain(`  ${home}/ops\n`)
    expect(out).toContain(`<key>VIBEDOCS_ROOTS_FILE</key><string>${home}/.vibedocs/roots.txt</string>`)
  })

  it('keeps --folders as it was: names under home, absolute paths, missing ones skipped', () => {
    const out = run('--folders', `ops,${home}/src/work,nope`, '--yes')
    expect(out).toContain(`✓ ${home}/ops`)
    expect(out).toContain(`✓ ${home}/src/work`)
    expect(out).toMatch(/! nope — not a directory, skipped/)
  })

  it('accepts a folder whose name contains a colon, since roots go to a line-based file', () => {
    // VIBEDOCS_ROOTS is colon-separated and could not express this; the roots file
    // can, so the old refusal is gone rather than carried over.
    expect(run('--folders', 'Work: Archive', '--yes')).toContain(`  ${home}/Work: Archive\n`)
  })

  it('binds to this machine only unless told otherwise', () => {
    expect(run('--folders', 'ops', '--yes')).toContain('<key>VIBEDOCS_HOST</key><string>127.0.0.1</string>')
    expect(run('--folders', 'ops', '--yes', '--host', '0.0.0.0')).toContain('<key>VIBEDOCS_HOST</key><string>0.0.0.0</string>')
  })

  it('writes nothing', () => {
    run('--folders', 'ops', '--yes')
    expect(existsSync(path.join(home, 'Library'))).toBe(false)
    expect(existsSync(path.join(home, '.vibedocs'))).toBe(false)
  })

  it('still refuses --yes without --folders', () => {
    expect(() => run('--yes')).toThrow()
  })
})

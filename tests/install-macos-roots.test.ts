import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
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
  it('writes VIBEDOCS_ROOTS into the plist', () => {
    expect(SCRIPT).toContain('VIBEDOCS_ROOTS')
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
    for (const flag of ['--folders', '--port', '--runs', '--yes', '--uninstall']) {
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

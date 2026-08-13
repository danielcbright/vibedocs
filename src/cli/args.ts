// Tiny hand-rolled arg parser for `vibedocs build`. No external dep — the
// surface is small enough (~6 flags) that pulling in commander/yargs costs
// more than it saves. Throws on malformed input; the dispatcher catches
// and converts the error into an actionable stderr message + exit code.

import path from 'path'
import type { HydrationPolicy } from '../shared/site-config-types.js'

export interface ParsedBuildArgs {
  projectName: string
  outDir?: string
  baseUrl?: string
  serve: boolean
  verbose: boolean
  port?: number
  frontendDist?: string
  /** `--hydration <full|minimal>` override; absent → resolve via siteConfig.hydration → 'full'. */
  hydration?: HydrationPolicy
}

const FLAGS_WITH_VALUE = new Set([
  '--project',
  '--out',
  '--base-url',
  '--port',
  '--frontend-dist',
  '--hydration',
])
const BOOL_FLAGS = new Set(['--serve', '--verbose'])

const HYDRATION_VALUES: ReadonlySet<HydrationPolicy> = new Set(['full', 'minimal'])

export function parseBuildArgs(argv: string[]): ParsedBuildArgs {
  const out: Partial<ParsedBuildArgs> = { serve: false, verbose: false }

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    if (FLAGS_WITH_VALUE.has(token)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value`)
      }
      assignFlagValue(out, token, value)
      i++ // consume value
    } else if (BOOL_FLAGS.has(token)) {
      if (token === '--serve') out.serve = true
      if (token === '--verbose') out.verbose = true
    } else {
      throw new Error(`unknown flag: ${token}`)
    }
  }

  if (!out.projectName) {
    throw new Error('--project <name> is required')
  }
  return out as ParsedBuildArgs
}

function assignFlagValue(out: Partial<ParsedBuildArgs>, flag: string, value: string): void {
  switch (flag) {
    case '--project':
      out.projectName = value
      break
    case '--out':
      out.outDir = value
      break
    case '--base-url':
      out.baseUrl = value
      break
    case '--frontend-dist':
      out.frontendDist = value
      break
    case '--port': {
      const n = Number(value)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        throw new Error(`--port must be a positive integer (got "${value}")`)
      }
      out.port = n
      break
    }
    case '--hydration': {
      if (!HYDRATION_VALUES.has(value as HydrationPolicy)) {
        throw new Error(
          `--hydration must be one of "full" | "minimal" (got "${value}")`,
        )
      }
      out.hydration = value as HydrationPolicy
      break
    }
  }
}

/**
 * Resolve the effective hydration policy from the CLI flag + siteConfig
 * field + hard-coded default, in that precedence order. Pure function so the
 * resolver is testable without spinning up a real build.
 *
 *   CLI --hydration → siteConfig.hydration → 'full'
 */
export interface ParsedServeArgs {
  /**
   * Directories containing the project folders to browse, in the order given.
   * Order matters: it decides which root keeps a project name two roots share.
   */
  roots: string[]
  /** Port for the HTTP + WebSocket server. */
  port: number
}

/**
 * Parse `vibedocs serve` flags. Both are optional — the zero-flag invocation
 * (`npx vibedocs serve`) browses the current directory on the default port,
 * which is the whole point of having the subcommand.
 *
 * `--root` is repeatable (#113). Repeatable rather than a colon-separated
 * `--roots` to mirror the env var, because the shell already separates arguments
 * and a path containing a colon would otherwise be unexpressible.
 */
export function parseServeArgs(argv: string[]): ParsedServeArgs {
  const roots: string[] = []
  let port = 8080

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!
    const value = argv[i + 1]
    if (token === '--root' || token === '--port') {
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value`)
      }
      if (token === '--root') {
        const resolved = path.resolve(value)
        if (!roots.includes(resolved)) roots.push(resolved)
      } else {
        const parsed = Number(value)
        if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
          throw new Error(`--port must be an integer between 1 and 65535, got "${value}"`)
        }
        port = parsed
      }
      i++ // consume value
    } else {
      throw new Error(`unknown flag: ${token}`)
    }
  }

  return { roots: roots.length > 0 ? roots : [process.cwd()], port }
}

export function resolveHydration(
  cliFlag: HydrationPolicy | undefined,
  siteConfigHydration: HydrationPolicy | undefined,
): HydrationPolicy {
  return cliFlag ?? siteConfigHydration ?? 'full'
}

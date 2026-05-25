// Tiny hand-rolled arg parser for `vibedocs build`. No external dep — the
// surface is small enough (5 flags) that pulling in commander/yargs costs
// more than it saves. Throws on malformed input; the dispatcher catches
// and converts the error into an actionable stderr message + exit code.

export interface ParsedBuildArgs {
  projectName: string
  outDir?: string
  baseUrl?: string
  serve: boolean
  port?: number
  frontendDist?: string
}

const FLAGS_WITH_VALUE = new Set([
  '--project',
  '--out',
  '--base-url',
  '--port',
  '--frontend-dist',
])
const BOOL_FLAGS = new Set(['--serve'])

export function parseBuildArgs(argv: string[]): ParsedBuildArgs {
  const out: Partial<ParsedBuildArgs> = { serve: false }

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
  }
}

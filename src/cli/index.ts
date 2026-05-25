// `vibedocs` CLI dispatcher.
//
// Today: only one subcommand, `build`. Future slices add `serve` standalone
// and possibly others; the dispatcher shape exists now so we don't have to
// reshuffle the entry point later.
//
// Invoked via `bin/vibedocs` (shebang script that loads this with tsx). The
// compiled equivalent ships in slice #12.

import path from 'path'
import { spawn } from 'child_process'
import { parseBuildArgs } from './args.js'
import { runBuild } from './build.js'

const USAGE = `Usage:
  vibedocs build --project <name> --out <dir> [--base-url <url>] [--frontend-dist <path>]
  vibedocs build --project <name> --serve [--port <n>] [--frontend-dist <path>]
`

export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    process.stdout.write(USAGE)
    return subcommand ? 0 : 1
  }

  if (subcommand !== 'build') {
    process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`)
    return 1
  }

  let parsed: ReturnType<typeof parseBuildArgs>
  try {
    parsed = parseBuildArgs(rest)
  } catch (err) {
    process.stderr.write(`vibedocs build: ${(err as Error).message}\n\n${USAGE}`)
    return 1
  }

  // Default out dir for --serve so the user doesn't have to specify both.
  const outDir = parsed.outDir ?? path.resolve(process.cwd(), 'dist')

  // PROJECTS_DIR is where to look for `<projectName>` as a sibling dir.
  // Mirrors discovery.ts. The cwd-basename fallback inside resolveProjectPath
  // handles "run inside the project repo" cases like vibedocs itself.
  const projectsRoot = process.env.VIBEDOCS_ROOT ?? process.cwd()

  // The React bundle ships next to the CLI source. When running through
  // `bin/vibedocs` via tsx, `import.meta.url` points at this file; the
  // frontend dist sits two directories up under `frontend/dist`. We accept
  // an override (--frontend-dist) for tests and unusual installs.
  const frontendDist =
    parsed.frontendDist ?? defaultFrontendDistPath()

  try {
    await runBuild({
      projectName: parsed.projectName,
      projectsRoot,
      outDir,
      frontendDist,
      ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
    })
  } catch (err) {
    process.stderr.write(`vibedocs build: ${(err as Error).message}\n`)
    return 1
  }

  process.stdout.write(`Built site to ${outDir}\n`)

  if (parsed.serve) {
    const port = parsed.port ?? 5050
    return await runServe(outDir, port)
  }

  return 0
}

function defaultFrontendDistPath(): string {
  // import.meta.url → file:///.../src/cli/index.ts (or .../dist/cli/index.js
  // once compiled). Walk up to the package root and append frontend/dist.
  const here = new URL('.', import.meta.url).pathname
  // <pkg>/src/cli/  → up 2 → <pkg>/
  return path.resolve(here, '..', '..', 'frontend', 'dist')
}

/**
 * Run sirv-cli against the output directory. We shell out (not import) so
 * that sirv stays an optional/devDependency and doesn't break the CLI when
 * the user only wants `build`.
 */
function runServe(outDir: string, port: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(
      'npx',
      ['--yes', 'sirv-cli', outDir, '--port', String(port), '--single'],
      { stdio: 'inherit' },
    )
    child.on('exit', (code) => resolve(code ?? 0))
    child.on('error', (err) => {
      process.stderr.write(`vibedocs serve: ${err.message}\n`)
      resolve(1)
    })
  })
}

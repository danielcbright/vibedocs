// `vibedocs serve` — run the live documentation browser from the npm package.
//
// Until this existed, the published CLI could only build static sites: the
// live app (search, live reload, diagrams, theme toggle) was reachable only by
// cloning the repo and running `npm start`, which made the package a poor match
// for what vibedocs advertises.
//
// Why a child process rather than `process.env.X = ...; await import(server)`:
// `discovery.ts` snapshots `PROJECTS_DIR` from the environment at module-load
// time, and the dispatcher statically imports `build.js` → `discovery.js`. By
// the time this function runs that snapshot has already been taken against an
// unset VIBEDOCS_ROOT, so an in-process import boots a server that ignores
// `--root` and silently serves the current directory instead. Re-execing gets a
// fresh module graph with the environment already correct, and stays correct no
// matter what the dispatcher imports later.

import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import type { ParsedServeArgs } from './args.js'
import { ROOTS_SEPARATOR } from '../project-roots.js'

/**
 * Locate the server entry and the argv needed to run it.
 *
 * Published installs get `dist-cli/server.js` (plain compiled JS). The dev path
 * (`bin/vibedocs`, which loads the CLI through tsx) has only `src/server.ts`,
 * so the child needs tsx registered too.
 */
function resolveServerEntry(): string[] | null {
  const here = path.dirname(fileURLToPath(import.meta.url))

  const compiled = path.resolve(here, '..', 'server.js')
  if (fs.existsSync(compiled)) return [compiled]

  const source = path.resolve(here, '..', 'server.ts')
  if (fs.existsSync(source)) return ['--import', 'tsx', source]

  return null
}

export async function runLiveServer(args: ParsedServeArgs): Promise<number> {
  for (const root of args.roots) {
    if (!fs.existsSync(root)) {
      process.stderr.write(`vibedocs serve: no such directory: ${root}\n`)
      return 1
    }
    if (!fs.statSync(root).isDirectory()) {
      process.stderr.write(`vibedocs serve: not a directory: ${root}\n`)
      return 1
    }
  }

  const entryArgs = resolveServerEntry()
  if (!entryArgs) {
    process.stderr.write(
      'vibedocs serve: could not locate the server entry point — this install looks incomplete.\n',
    )
    return 1
  }

  // Always the list form, even for one root, and with the inherited single-root
  // variable REMOVED: the server reads VIBEDOCS_ROOTS first, so leaving an
  // exported VIBEDOCS_ROOT in place would mean the child carries two answers to
  // the same question and warns about the one the operator did not type.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, VIBEDOCS_PORT: String(args.port) }
  delete childEnv.VIBEDOCS_ROOT
  childEnv.VIBEDOCS_ROOTS = args.roots.join(ROOTS_SEPARATOR)

  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, entryArgs, {
      stdio: 'inherit',
      env: childEnv,
    })
    child.on('exit', (code) => resolve(code ?? 0))
    child.on('error', (err) => {
      process.stderr.write(`vibedocs serve: ${err.message}\n`)
      resolve(1)
    })
  })
}

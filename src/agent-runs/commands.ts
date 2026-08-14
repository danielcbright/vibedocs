/**
 * Per-run command queue — file-backed intent channel between the browser UI
 * and the dispatch client. VibeDocs never executes commands; it only records
 * them and lets the owning client long-poll, act, and ack.
 *
 *   <runsDir>/<runId>/commands.json
 */

import { readFile, writeFile, rename, mkdir } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import type { RunCommand, RunCommandKind } from '../shared/agent-run-types.js'
import { assertValidRunId } from './store.js'
import { VibedocsError } from '../errors.js'

const COMMANDS_FILE = 'commands.json'

interface CommandFile {
  commands: RunCommand[]
}

export interface CommandQueue {
  enqueueCommand(runId: string, kind: RunCommandKind): Promise<RunCommand>
  listPendingCommands(runId: string, opts?: { waitMs?: number }): Promise<RunCommand[]>
  ackCommand(runId: string, cmdId: string, note?: string): Promise<RunCommand>
}

export function createCommandQueue(opts: { runsDir: string }): CommandQueue {
  const { runsDir } = opts

  /** Per-run waiters notified when a command is enqueued. */
  const waiters = new Map<string, Set<() => void>>()

  function runDir(id: string): string {
    return path.join(runsDir, assertValidRunId(id))
  }

  async function readFile_(id: string): Promise<CommandFile> {
    try {
      return JSON.parse(await readFile(path.join(runDir(id), COMMANDS_FILE), 'utf8')) as CommandFile
    } catch {
      return { commands: [] }
    }
  }

  async function writeFile_(id: string, data: CommandFile): Promise<void> {
    const dir = runDir(id)
    await mkdir(dir, { recursive: true })
    const tmp = path.join(dir, `.${COMMANDS_FILE}.${randomUUID()}.tmp`)
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
    await rename(tmp, path.join(dir, COMMANDS_FILE))
  }

  function pending(commands: RunCommand[]): RunCommand[] {
    return commands.filter((c) => c.ackedAt === undefined)
  }

  function notifyWaiters(id: string): void {
    const set = waiters.get(id)
    if (!set) return
    for (const wake of set) wake()
    waiters.delete(id)
  }

  function waitForCommand(id: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const set = waiters.get(id)
        if (set) {
          set.delete(wake)
          if (set.size === 0) waiters.delete(id)
        }
        resolve()
      }, timeoutMs)

      const wake = () => {
        clearTimeout(timer)
        resolve()
      }

      let set = waiters.get(id)
      if (!set) {
        set = new Set()
        waiters.set(id, set)
      }
      set.add(wake)
    })
  }

  return {
    async enqueueCommand(id, kind) {
      const file = await readFile_(id)
      const existing = pending(file.commands).find((c) => c.kind === kind)
      if (existing) return existing

      const cmd: RunCommand = { id: randomUUID(), kind, createdAt: Date.now() }
      file.commands.push(cmd)
      await writeFile_(id, file)
      notifyWaiters(id)
      return cmd
    },

    async listPendingCommands(id, opts) {
      const waitMs = Math.min(Math.max(opts?.waitMs ?? 25000, 0), 60000)
      let cmds = pending((await readFile_(id)).commands)
      if (cmds.length > 0) return cmds

      if (waitMs > 0) {
        await waitForCommand(id, waitMs)
        cmds = pending((await readFile_(id)).commands)
      }
      return cmds
    },

    async ackCommand(id, cmdId, note) {
      const file = await readFile_(id)
      const cmd = file.commands.find((c) => c.id === cmdId)
      if (!cmd) throw new VibedocsError('not-found', 'Command not found')
      if (cmd.ackedAt !== undefined) return cmd

      cmd.ackedAt = Date.now()
      if (note !== undefined) cmd.ackNote = note
      await writeFile_(id, file)
      return cmd
    },
  }
}

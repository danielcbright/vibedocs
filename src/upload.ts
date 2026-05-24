import { writeFile, access } from 'fs/promises'
import path from 'path'
import { VibedocsError } from './errors.js'
import type { SafePath } from './path-resolver.js'

const MAX_CONFLICT_SUFFIX = 100

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export interface WriteResult {
  originalName: string
  savedName: string
  path: string
}

export async function safeWriteFile(
  targetDir: SafePath,
  originalName: string,
  data: Buffer
): Promise<WriteResult> {
  // Strip directory components to prevent path traversal via filename
  const safeName = path.basename(originalName)
  if (!safeName) {
    throw new VibedocsError('invalid', `Invalid filename: "${originalName}"`)
  }

  const ext = path.extname(safeName)
  const base = ext
    ? safeName.slice(0, -ext.length)
    : safeName

  // Check original name first, then try suffixes -1 through -100
  let candidate = safeName
  let fullPath = path.join(targetDir, candidate)

  if (await fileExists(fullPath)) {
    let found = false
    for (let i = 1; i <= MAX_CONFLICT_SUFFIX; i++) {
      candidate = ext ? `${base}-${i}${ext}` : `${base}-${i}`
      fullPath = path.join(targetDir, candidate)
      if (!(await fileExists(fullPath))) {
        found = true
        break
      }
    }
    if (!found) {
      throw new VibedocsError('conflict', `Too many naming conflicts for "${originalName}"`)
    }
  }

  try {
    await writeFile(fullPath, data)
  } catch (err) {
    throw new VibedocsError('io', 'Failed to write file', { cause: err })
  }

  return {
    originalName: safeName,
    savedName: candidate,
    path: candidate,
  }
}

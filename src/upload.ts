import { writeFile, access } from 'fs/promises'
import path from 'path'
import { VibedocsError } from './errors.js'

const MAX_CONFLICT_SUFFIX = 100

/**
 * Resolve an upload target directory inside a project, with two-layer
 * path-traversal defense. Throws `VibedocsError('traversal')` if the resolved
 * path escapes either the projects root or the project root.
 */
export function resolveUploadDir(
  projectsDir: string,
  project: string,
  folderPath: string
): string {
  const resolvedProjectsDir = path.resolve(projectsDir)
  const projectDir = path.resolve(resolvedProjectsDir, project)

  // Project directory must be within the projects root
  if (!projectDir.startsWith(resolvedProjectsDir + path.sep)) {
    throw new VibedocsError('traversal', 'Invalid path')
  }

  const target = folderPath
    ? path.resolve(projectDir, folderPath)
    : projectDir

  // Target must be within the project directory
  if (!target.startsWith(projectDir + path.sep) && target !== projectDir) {
    throw new VibedocsError('traversal', 'Invalid path')
  }

  return target
}

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
  targetDir: string,
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

import { writeFile, access } from 'fs/promises'
import path from 'path'

const MAX_CONFLICT_SUFFIX = 100

export function resolveUploadDir(
  projectsDir: string,
  project: string,
  folderPath: string
): string | null {
  const resolvedProjectsDir = path.resolve(projectsDir)
  const projectDir = path.resolve(resolvedProjectsDir, project)

  // Project directory must be within the projects root
  if (!projectDir.startsWith(resolvedProjectsDir + path.sep)) {
    return null
  }

  const target = folderPath
    ? path.resolve(projectDir, folderPath)
    : projectDir

  // Target must be within the project directory
  if (!target.startsWith(projectDir + path.sep) && target !== projectDir) {
    return null
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
    throw new Error(`Invalid filename: "${originalName}"`)
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
      throw new Error(`Too many naming conflicts for "${originalName}"`)
    }
  }

  await writeFile(fullPath, data)

  return {
    originalName: safeName,
    savedName: candidate,
    path: candidate,
  }
}

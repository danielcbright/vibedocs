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
  const ext = path.extname(originalName)
  const base = ext
    ? originalName.slice(0, -ext.length)
    : originalName

  // Check original name first, then try suffixes -1 through -100
  let candidate = originalName
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
    originalName,
    savedName: candidate,
    path: candidate,
  }
}

# File Upload Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add file upload capability to VibeDocs — users can upload any file to a selected folder via the sidebar.

**Architecture:** New `POST /api/upload/:project/*` endpoint accepts multipart form data and writes files to the target folder with conflict auto-renaming. New `GET /api/file/:project/*` serves non-markdown files. Discovery expands to show all files. Frontend adds an upload button on folder rows.

**Tech Stack:** Hono 4 (multipart parsing built-in), Vitest (new test runner), React 19, lucide-react icons.

---

### Task 1: Set Up Vitest Test Runner

The project has no test runner. We need Vitest before writing any tests.

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (add vitest dev dependency + test script)
- Modify: `tsconfig.json` (include tests directory)

**Step 1: Install vitest**

Run: `npm install -D vitest`

**Step 2: Create vitest config**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
```

**Step 3: Add test script to package.json**

Add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Update tsconfig.json to include tests**

Change `"include"` from `["src"]` to `["src", "tests"]`.

**Step 5: Verify setup with a smoke test**

Create `tests/smoke.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

describe('test setup', () => {
  it('works', () => {
    expect(1 + 1).toBe(2)
  })
})
```

Run: `npm test`
Expected: 1 test passes.

**Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json tsconfig.json tests/smoke.test.ts
git commit -m "chore: add vitest test runner"
```

---

### Task 2: Create Upload Module with Path Validation

Extract upload logic into `src/upload.ts` — path resolution, conflict renaming, file writing. This module is pure logic, no Hono dependency, easy to test.

**Files:**
- Create: `src/upload.ts`
- Create: `tests/upload.test.ts`

**Step 1: Write the failing tests**

Create `tests/upload.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises'
import path from 'path'
import os from 'os'
import { resolveUploadDir, safeWriteFile } from '../src/upload.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await import('fs/promises').then(fs =>
    fs.mkdtemp(path.join(os.tmpdir(), 'vibedocs-test-'))
  )
  // Create a project structure: tmpDir/myproject/docs/
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('resolveUploadDir', () => {
  it('resolves a valid folder path within a project', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', 'docs')
    expect(result).toBe(path.join(tmpDir, 'myproject', 'docs'))
  })

  it('resolves project root when folder path is empty', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', '')
    expect(result).toBe(path.join(tmpDir, 'myproject'))
  })

  it('rejects path traversal with ..', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', '../otherproject')
    expect(result).toBeNull()
  })

  it('rejects path traversal in project name', () => {
    const result = resolveUploadDir(tmpDir, '../etc', 'docs')
    expect(result).toBeNull()
  })

  it('rejects absolute paths in folder', () => {
    const result = resolveUploadDir(tmpDir, 'myproject', '/etc/passwd')
    expect(result).toBeNull()
  })
})

describe('safeWriteFile', () => {
  it('writes a file to the target directory', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    const result = await safeWriteFile(targetDir, 'test.md', Buffer.from('# Hello'))
    expect(result.savedName).toBe('test.md')
    const content = await readFile(path.join(targetDir, 'test.md'), 'utf-8')
    expect(content).toBe('# Hello')
  })

  it('renames on conflict with extension', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'readme.md'), 'existing')
    const result = await safeWriteFile(targetDir, 'readme.md', Buffer.from('new'))
    expect(result.savedName).toBe('readme-1.md')
    const content = await readFile(path.join(targetDir, 'readme-1.md'), 'utf-8')
    expect(content).toBe('new')
  })

  it('renames on conflict without extension', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'Makefile'), 'existing')
    const result = await safeWriteFile(targetDir, 'Makefile', Buffer.from('new'))
    expect(result.savedName).toBe('Makefile-1')
  })

  it('increments suffix until a free name is found', async () => {
    const targetDir = path.join(tmpDir, 'myproject', 'docs')
    await writeFile(path.join(targetDir, 'img.png'), 'v0')
    await writeFile(path.join(targetDir, 'img-1.png'), 'v1')
    await writeFile(path.join(targetDir, 'img-2.png'), 'v2')
    const result = await safeWriteFile(targetDir, 'img.png', Buffer.from('v3'))
    expect(result.savedName).toBe('img-3.png')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `cannot find module '../src/upload.js'`

**Step 3: Implement the upload module**

Create `src/upload.ts`:

```typescript
import { writeFile, access } from 'fs/promises'
import path from 'path'

const MAX_CONFLICT_SUFFIX = 100

export function resolveUploadDir(
  projectsDir: string,
  project: string,
  folderPath: string
): string | null {
  const projectDir = path.join(projectsDir, project)
  const target = folderPath
    ? path.resolve(projectDir, folderPath)
    : projectDir

  // Must be within the project directory
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

  let candidate = originalName
  let fullPath = path.join(targetDir, candidate)

  for (let i = 1; i <= MAX_CONFLICT_SUFFIX; i++) {
    if (!(await fileExists(fullPath))) break
    candidate = ext ? `${base}-${i}${ext}` : `${base}-${i}`
    fullPath = path.join(targetDir, candidate)
    if (i === MAX_CONFLICT_SUFFIX) {
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
```

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/upload.ts tests/upload.test.ts
git commit -m "feat: add upload module with path validation and conflict renaming"
```

---

### Task 3: Add Upload and File-Serving API Endpoints

Wire the upload module into `server.ts` with two new routes.

**Files:**
- Modify: `src/server.ts`
- Create: `tests/server-upload.test.ts`

**Step 1: Write the failing tests**

Create `tests/server-upload.test.ts`. Use Hono's built-in test helper (call `app.request()` directly — no need for supertest).

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm, readFile, readdir, stat } from 'fs/promises'
import path from 'path'
import os from 'os'

let tmpDir: string

// We need to set VIBEDOCS_ROOT before importing the server module.
// The server module reads PROJECTS_DIR on import from discovery.ts.
// Instead, we test the route handlers by creating a small Hono app
// that mirrors the server's upload routes, pointed at our temp dir.

import { Hono } from 'hono'
import { resolveUploadDir, safeWriteFile } from '../src/upload.js'

function createTestApp(projectsDir: string) {
  const app = new Hono()

  app.post('/api/upload/:project/*', async (c) => {
    const project = c.req.param('project')
    const fullPath = new URL(c.req.url).pathname
    const prefix = `/api/upload/${encodeURIComponent(project)}/`
    const folderPath = fullPath.startsWith(prefix)
      ? decodeURIComponent(fullPath.slice(prefix.length))
      : (c.req.param('*') || '')

    const targetDir = resolveUploadDir(projectsDir, project, folderPath)
    if (!targetDir) return c.json({ error: 'Invalid path' }, 400)

    try {
      await stat(targetDir)
    } catch {
      return c.json({ error: 'Target folder not found' }, 404)
    }

    const body = await c.req.parseBody({ all: true })
    const files = body['files']
    if (!files) return c.json({ error: 'No files provided' }, 400)

    const fileList = Array.isArray(files) ? files : [files]
    const uploaded = fileList.filter((f): f is File => f instanceof File)
    if (uploaded.length === 0) return c.json({ error: 'No files provided' }, 400)

    const results = []
    for (const file of uploaded) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await safeWriteFile(targetDir, file.name, buffer)
      results.push(result)
    }

    return c.json({ data: results })
  })

  return app
}

beforeEach(async () => {
  tmpDir = await import('fs/promises').then(fs =>
    fs.mkdtemp(path.join(os.tmpdir(), 'vibedocs-server-test-'))
  )
  await mkdir(path.join(tmpDir, 'myproject', 'docs'), { recursive: true })
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

describe('POST /api/upload/:project/*', () => {
  it('uploads a file to the target folder', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['# Test'], 'test.md', { type: 'text/markdown' }))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(1)
    expect(json.data[0].savedName).toBe('test.md')

    const content = await readFile(path.join(tmpDir, 'myproject', 'docs', 'test.md'), 'utf-8')
    expect(content).toBe('# Test')
  })

  it('uploads multiple files', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['a'], 'a.md'))
    formData.append('files', new File(['b'], 'b.md'))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data).toHaveLength(2)
  })

  it('rejects path traversal', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['bad'], 'evil.md'))

    const res = await app.request('/api/upload/myproject/../../etc', { method: 'POST', body: formData })
    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent folder', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['x'], 'x.md'))

    const res = await app.request('/api/upload/myproject/nonexistent', { method: 'POST', body: formData })
    expect(res.status).toBe(404)
  })

  it('returns 400 when no files attached', async () => {
    const app = createTestApp(tmpDir)
    const formData = new FormData()

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(400)
  })

  it('auto-renames on conflict', async () => {
    await writeFile(path.join(tmpDir, 'myproject', 'docs', 'exist.md'), 'old')
    const app = createTestApp(tmpDir)
    const formData = new FormData()
    formData.append('files', new File(['new'], 'exist.md'))

    const res = await app.request('/api/upload/myproject/docs', { method: 'POST', body: formData })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].savedName).toBe('exist-1.md')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: Tests pass (they use the upload module from Task 2, tested against a local Hono app). This validates the route logic in isolation.

**Step 3: Add the upload route to server.ts**

Add after the existing `/api/search` route in `src/server.ts`:

```typescript
import { stat as fsStat } from 'fs/promises'
import { resolveUploadDir, safeWriteFile } from './upload.js'
```

```typescript
app.post('/api/upload/:project/*', async (c) => {
  const project = c.req.param('project')
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/upload/${encodeURIComponent(project)}/`
  const folderPath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  const targetDir = resolveUploadDir(PROJECTS_DIR, project, folderPath)
  if (!targetDir) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  try {
    const s = await fsStat(targetDir)
    if (!s.isDirectory()) {
      return c.json({ error: 'Target is not a directory' }, 400)
    }
  } catch {
    return c.json({ error: 'Target folder not found' }, 404)
  }

  const body = await c.req.parseBody({ all: true })
  const files = body['files']
  if (!files) {
    return c.json({ error: 'No files provided' }, 400)
  }

  const fileList = Array.isArray(files) ? files : [files]
  const uploaded = fileList.filter((f): f is File => f instanceof File)
  if (uploaded.length === 0) {
    return c.json({ error: 'No files provided' }, 400)
  }

  try {
    const results = []
    for (const file of uploaded) {
      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await safeWriteFile(targetDir, file.name, buffer)
      results.push(result)
    }
    // Trigger sidebar refresh for all clients
    broadcast({ type: 'refresh-tree' })
    return c.json({ data: results })
  } catch (err: any) {
    console.error('Upload error:', err)
    return c.json({ error: err.message || 'Upload failed' }, 500)
  }
})
```

**Step 4: Add the file-serving route to server.ts**

Add after the upload route:

```typescript
app.get('/api/file/:project/*', async (c) => {
  const project = c.req.param('project')
  const fullPath = new URL(c.req.url).pathname
  const prefix = `/api/file/${encodeURIComponent(project)}/`
  const filePath = fullPath.startsWith(prefix)
    ? decodeURIComponent(fullPath.slice(prefix.length))
    : (c.req.param('*') || '')

  if (!project || !filePath) {
    return c.json({ error: 'Missing project or path' }, 400)
  }

  // Reuse upload's path resolver (it validates traversal), but target is a file not dir
  const projectDir = path.join(PROJECTS_DIR, project)
  const resolved = path.resolve(projectDir, filePath)
  if (!resolved.startsWith(projectDir + path.sep) && resolved !== projectDir) {
    return c.json({ error: 'Invalid path' }, 400)
  }

  try {
    const content = await readFile(resolved)
    const ext = path.extname(resolved).toLowerCase()
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'
    return new Response(content, {
      headers: { 'Content-Type': contentType },
    })
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return c.json({ error: 'File not found' }, 404)
    }
    return c.json({ error: 'Failed to read file' }, 500)
  }
})
```

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/server.ts tests/server-upload.test.ts
git commit -m "feat: add upload and file-serving API endpoints"
```

---

### Task 4: Expand Discovery to Include Non-Markdown Files

**Files:**
- Modify: `src/discovery.ts`
- Modify: `tests/upload.test.ts` (add discovery tests)

**Step 1: Write the failing tests**

Add to `tests/upload.test.ts` (or create `tests/discovery.test.ts`):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import path from 'path'
import os from 'os'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await import('fs/promises').then(fs =>
    fs.mkdtemp(path.join(os.tmpdir(), 'vibedocs-discovery-test-'))
  )
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

// We test buildTree directly by importing it.
// discovery.ts currently doesn't export buildTree, so we'll need to export it
// or test through discoverProjects by temporarily setting PROJECTS_DIR.

// Testing approach: import the buildTree function after we export it.
import { buildTreePublic } from '../src/discovery.js'

describe('buildTree with non-markdown files', () => {
  it('includes image files in the tree', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const docsDir = path.join(projectRoot, 'docs')
    await mkdir(docsDir, { recursive: true })
    await writeFile(path.join(docsDir, 'guide.md'), '# Guide')
    await writeFile(path.join(docsDir, 'screenshot.png'), 'fake-png')

    const tree = await buildTreePublic(docsDir, projectRoot)
    const names = tree.map(n => n.name).sort()
    expect(names).toEqual(['guide.md', 'screenshot.png'])
  })

  it('marks non-markdown files with isAsset flag', async () => {
    const projectRoot = path.join(tmpDir, 'proj')
    const docsDir = path.join(projectRoot, 'docs')
    await mkdir(docsDir, { recursive: true })
    await writeFile(path.join(docsDir, 'notes.md'), '# Notes')
    await writeFile(path.join(docsDir, 'photo.jpg'), 'fake-jpg')

    const tree = await buildTreePublic(docsDir, projectRoot)
    const md = tree.find(n => n.name === 'notes.md')!
    const img = tree.find(n => n.name === 'photo.jpg')!
    expect(md.isAsset).toBeFalsy()
    expect(img.isAsset).toBe(true)
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `buildTreePublic` not exported, `isAsset` not on FileNode.

**Step 3: Modify discovery.ts**

Changes to `src/discovery.ts`:

1. Add `isAsset?: boolean` to `FileNode` interface.
2. In `buildTree()`, remove the filter that only includes `.md`/`.markdown` files. Include all non-hidden files. Set `isAsset: true` for non-markdown files.
3. Export a `buildTreePublic` alias for testing (or just export `buildTree`).

The key change in `buildTree`:

```typescript
} else if (s.isFile()) {
  if (s.size === 0) continue
  const isMd = entry.endsWith('.md') || entry.endsWith('.markdown')
  nodes.push({
    name: entry,
    path: relPath,
    type: 'file',
    ...(!isMd && { isAsset: true }),
  })
}
```

Also update `getRootMarkdownFiles` — keep it markdown-only (root level should stay clean; non-md assets mainly live in subdirectories).

Export: `export { buildTree as buildTreePublic }` at bottom of file.

**Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/discovery.ts tests/discovery.test.ts
git commit -m "feat: include non-markdown files in project tree with isAsset flag"
```

---

### Task 5: Update Frontend FileNode Type and Sidebar Icons

**Files:**
- Modify: `frontend/src/hooks/use-projects.ts` (add `isAsset` to type)
- Modify: `frontend/src/components/app-sidebar.tsx` (asset icon + upload button)

**Step 1: Add isAsset to FileNode type**

In `frontend/src/hooks/use-projects.ts`, add to `FileNode`:

```typescript
export interface FileNode {
  name: string
  path: string
  type: "file" | "folder"
  children?: FileNode[]
  isAsset?: boolean
}
```

**Step 2: Update sidebar to show asset icons**

In `app-sidebar.tsx`, in the file node rendering section:

- Import `Image`, `FileText`, `Upload` from lucide-react
- For markdown files: use `FileText` icon
- For asset files: use `Image` icon (or generic `File` for non-image assets)
- Clicking an asset file opens `/api/file/:project/:path` in a new tab

**Step 3: Add upload button on folder rows**

In `app-sidebar.tsx`, in the folder rendering section:

- Add an `Upload` icon button that appears on hover (use CSS `group-hover`)
- The button has an associated hidden `<input type="file" multiple>` element
- Clicking the upload button triggers the file input
- On file selection, POST to `/api/upload/:project/:folderPath/`
- After success, the WebSocket `refresh-tree` broadcast will auto-refresh the sidebar

Add a helper function at the top of the file:

```typescript
async function uploadFiles(project: string, folderPath: string, files: FileList) {
  const formData = new FormData()
  for (const file of Array.from(files)) {
    formData.append('files', file)
  }
  const res = await fetch(`/api/upload/${encodeURIComponent(project)}/${folderPath}`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(err.error || 'Upload failed')
  }
  return res.json()
}
```

**Step 4: Add upload status feedback**

Add a simple state variable for upload feedback:

```typescript
const [uploadStatus, setUploadStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
```

Show a small inline message near the sidebar header that auto-dismisses after 3 seconds.

**Step 5: Build and verify**

Run: `cd frontend && npx vite build`
Expected: Build succeeds with no TypeScript errors.

**Step 6: Commit**

```bash
git add frontend/src/hooks/use-projects.ts frontend/src/components/app-sidebar.tsx
git commit -m "feat: add upload button to sidebar folders and asset file icons"
```

---

### Task 6: Expand Chokidar Watcher for Non-Markdown Files

Currently the watcher only watches `**/*.md`. After uploading an image, the sidebar won't auto-refresh because Chokidar doesn't see it. We need to broaden the watch glob.

**Files:**
- Modify: `src/server.ts`

**Step 1: Update the watch glob**

In `src/server.ts`, change:

```typescript
const watchGlob = path.join(PROJECTS_DIR, '**/*.md')
```

To:

```typescript
const watchGlob = path.join(PROJECTS_DIR, '**/*')
```

The `.on('change')` handler already broadcasts `reload` — this is fine for markdown. For non-markdown file changes we just need `refresh-tree`. Adjust handlers:

```typescript
.on('change', (filePath: string) => {
  console.log(`  ↺  changed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
  if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
    broadcast({ type: 'reload', path: filePath })
    buildSearchIndex()
  } else {
    broadcast({ type: 'refresh-tree' })
  }
})
.on('add', (filePath: string) => {
  console.log(`  +  added:   ${filePath.replace(PROJECTS_DIR + '/', '')}`)
  broadcast({ type: 'refresh-tree' })
  if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
    buildSearchIndex()
  }
})
.on('unlink', (filePath: string) => {
  console.log(`  -  removed: ${filePath.replace(PROJECTS_DIR + '/', '')}`)
  broadcast({ type: 'refresh-tree' })
  if (filePath.endsWith('.md') || filePath.endsWith('.markdown')) {
    buildSearchIndex()
  }
})
```

**Step 2: Verify manually**

Run: `npm run dev:server`
Drop a `.png` into a project's docs folder.
Expected: Console shows `+ added: ...` and `refresh-tree` broadcast fires.

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: expand file watcher to detect non-markdown file changes"
```

---

### Task 7: Manual Browser Testing and Polish

**Step 1: Start dev servers**

Run: `npm run dev`

**Step 2: Test upload workflow**

1. Open `http://localhost:5173` in browser
2. Expand a project in the sidebar
3. Hover over a folder — verify upload icon appears
4. Click upload icon — verify file picker opens
5. Select a markdown file — verify it appears in the tree
6. Select an image file — verify it appears with asset icon
7. Click the image file — verify it opens in a new tab via `/api/file/...`
8. Upload a file with a name that already exists — verify auto-rename works
9. Check the inline upload status message appears and auto-dismisses

**Step 3: Test error cases**

1. Try uploading with no files selected (cancel the picker) — no error shown
2. Check browser console for any errors during normal operation

**Step 4: Fix any issues found during testing**

Address bugs found in steps 2-3.

**Step 5: Final commit**

```bash
git add -A
git commit -m "fix: polish upload UI from manual testing"
```

(Only if changes were needed.)

---

### Task 8: Delete Smoke Test and Final Cleanup

**Files:**
- Delete: `tests/smoke.test.ts`

**Step 1: Remove the smoke test**

Delete `tests/smoke.test.ts` — it was scaffolding.

**Step 2: Run all tests one final time**

Run: `npm test`
Expected: All real tests pass.

**Step 3: Promote to production**

Run: `./scripts/promote.sh`
Expected: 6-step pipeline completes successfully.

**Step 4: Commit and prepare PR**

```bash
git add -A
git commit -m "chore: remove smoke test scaffolding"
```

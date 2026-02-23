# File Upload Feature Design

**Date:** 2026-02-23
**Status:** Approved

## Summary

Add file upload capability to VibeDocs. Users can upload any file type to a selected folder in the sidebar. Files are written to disk relative to the chosen folder within the project directory.

## Design Decisions

- **Upload target:** Relative to the folder selected in the sidebar
- **File types:** Any file type allowed (no restrictions)
- **UI interaction:** Upload icon button on folder rows in sidebar (visible on hover), opens native file picker with multi-select
- **Conflict handling:** Auto-rename with numeric suffix (`foo.png` → `foo-1.png` → `foo-2.png`). No overwrites.
- **Approach:** Simple multipart POST endpoint (Approach A). No chunked uploads or WebSocket-based transfer.

## Backend

### New endpoint: `POST /api/upload/:project/*`

- Accepts `multipart/form-data` with files in a `files` field
- Wildcard path captures the target folder (e.g., `/api/upload/vibedocs/docs/plans/`)
- Path validation: resolved path must be within the project directory (same traversal protection as `resolveDocPath()`)
- Validates the target is an existing directory
- Conflict renaming: checks existence in a loop up to 100 suffixes
  - With extension: `name.ext` → `name-1.ext` → `name-2.ext`
  - Without extension: `name` → `name-1` → `name-2`
- Returns JSON: `{ data: [{ originalName, savedName, path }] }`
- Broadcasts `refresh-tree` via WebSocket after successful upload
- No file size limit (local tool, not public-facing)

### New endpoint: `GET /api/file/:project/*`

- Serves non-markdown files with correct content type for viewing/downloading
- Same path traversal protection
- Allows any file type (not restricted to `.md`)

### Discovery changes (`discovery.ts`)

- Expand `buildTree()` to include non-markdown files in the tree
- Non-markdown files get `type: 'file'` with a flag or distinct handling so the frontend can differentiate

## Frontend

### Sidebar (`app-sidebar.tsx`)

- Add upload icon (lucide `Upload`) on folder rows, visible on hover
- Click opens `<input type="file" multiple>` native file picker
- After selection, POST files to `/api/upload/:project/:folderPath/`
- Show inline status message after upload (success/error)

### File tree changes

- Non-markdown files appear in the sidebar with distinct icon
- Clicking a non-markdown file opens it via `/api/file/:project/*` (view/download)
- Markdown files continue to render in the content panel as before

### No changes to

- TOC panel, search index (markdown-only), doc content rendering, theme system

## Error Handling

| Scenario | Response |
|----------|----------|
| Target folder doesn't exist | 404 — no auto-creation |
| Path traversal attempt | 400 — invalid path |
| Empty file list | 400 — no files provided |
| Disk write failure | 500 — reports which file failed, already-written files stay |
| 100+ naming conflicts | 500 — conflict limit exceeded |

## Testing

- **Backend tests:** Upload endpoint with Hono test client — valid uploads, path traversal rejection, conflict renaming, missing folder, empty request
- **Manual browser testing:** Upload via sidebar, verify files land correctly, sidebar refreshes, non-markdown files visible and accessible

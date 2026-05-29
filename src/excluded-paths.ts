/**
 * Single source of truth for directory names that vibedocs refuses to walk,
 * index, or serve.
 *
 * Three layers consume this set:
 *
 * 1. **Discovery** (`src/discovery.ts`) hides matching folders from project
 *    file trees so they never appear in the UI.
 * 2. **Search** (`src/search.ts`) skips matching folders when building the
 *    in-memory full-text index.
 * 3. **Path resolver** (`src/path-resolver.ts`) rejects any request whose
 *    resolved path contains a matching segment — closing the file-serving
 *    backdoor that could otherwise re-expose `.git/config`, `node_modules`,
 *    build artefacts, etc.
 *
 * Adding a new entry here propagates to all three layers automatically.
 * Do NOT redefine this set anywhere else.
 */
export const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out',
  'coverage', 'tmp', 'temp', '_archived',
  '.project-template', 'test-projects',
])

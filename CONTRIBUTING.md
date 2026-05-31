# Contributing to VibeDocs

Thanks for your interest in contributing!

## Getting Started

```bash
# Fork and clone the repo
git clone https://github.com/<your-username>/vibedocs.git
cd vibedocs

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Point at a directory with some markdown projects
export VIBEDOCS_ROOT=/path/to/your/projects

# Start development servers
npm run dev
```

This starts the Hono backend on port 8080 and the Vite dev server on port 5173 (with API proxy).

## Making Changes

1. Create a feature branch: `git checkout -b my-feature`
2. Make your changes
3. Run tests: `npm test`
4. Test that the build works: `npm run build`
5. Commit your changes with a clear message
6. Open a pull request

## Project Structure

- `src/` — Backend (Hono server, discovery, markdown pipeline, search)
- `frontend/src/` — Frontend (React + shadcn/ui)
- `docs/` — Architecture documentation

See `CLAUDE.md` for detailed architecture notes. If you use Claude Code, it will read this file automatically to understand the codebase.

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style and patterns
- Run `npm test` and `npm run build` before submitting
- Backend tests use Vitest — add tests in `tests/` for new backend functionality
- Frontend uses shadcn/ui — add new UI components via the shadcn CLI

## Security: secret + PII scanning

Every commit is scanned by [gitleaks](https://github.com/gitleaks/gitleaks) for credentials and the project-specific PII patterns defined in `.gitleaks.toml`. Pre-commit catches it locally; CI catches it on push as a backstop.

**Install gitleaks once per machine** so the local hook actually runs:

```bash
# macOS
brew install gitleaks

# Linux (binary to ~/.local/bin)
curl -sSfL https://raw.githubusercontent.com/gitleaks/gitleaks/master/scripts/install.sh | sh -s -- -b ~/.local/bin

# Verify
gitleaks version
```

Without gitleaks installed, the pre-commit hook prints a warning and lets the commit through — CI is the backstop, but you'll have to amend or force-push if it fails there.

If a scan flags a false positive, add an allowlist entry to `.gitleaks.toml` rather than `--no-verify`-ing.

## Reporting Issues

Open an issue at https://github.com/danielcbright/vibedocs/issues with:
- What you expected to happen
- What actually happened
- Steps to reproduce

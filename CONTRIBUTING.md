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
3. Test that the build works: `npm run build`
4. Commit your changes with a clear message
5. Open a pull request

## Project Structure

- `src/` — Backend (Hono server, discovery, markdown pipeline, search)
- `frontend/src/` — Frontend (React + shadcn/ui)
- `docs/` — Architecture documentation

See `CLAUDE.md` for detailed architecture notes. If you use Claude Code, it will read this file automatically to understand the codebase.

## Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow existing code style and patterns
- Test with `npm run build` before submitting
- Frontend uses shadcn/ui — add new UI components via the shadcn CLI

## Reporting Issues

Open an issue at https://github.com/danielcbright/vibedocs/issues with:
- What you expected to happen
- What actually happened
- Steps to reproduce

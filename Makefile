# Front door for vibedocs. Every target delegates to an npm script — this file
# deliberately owns NO build logic of its own.
#
# Why it works this way: npm invokes lifecycle scripts itself (`npm publish`
# runs `prepare`, and that is what builds frontend/dist/ into the tarball). Make
# is never in that path and cannot be. So package.json stays the single source
# of truth for what a task *does*, and this file only makes the task list
# discoverable — `make help`, tab-completion, one obvious entry point.
#
# If you add a target here, it should be one line that calls one npm script. The
# moment a target grows real logic, that logic belongs in package.json or a
# script under scripts/, or the two surfaces will drift.

.DEFAULT_GOAL := help
# Every target is a task name, not a file to build.
.PHONY: help install dev build build-cli typecheck typecheck-frontend test test-backend test-frontend verify pack-inspect release-check clean

help: ## Show this help
	@echo "vibedocs — make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Release: release-check -> verify -> pack-inspect -> push a v* tag."
	@echo "CI publishes from the tag via OIDC; there is no local publish step."

install: ## Install backend deps
	npm install

dev: ## Run backend (8080) + Vite dev server (5173)
	npm run dev

build: ## Build the frontend into frontend/dist/
	npm run build

build-cli: ## Compile the CLI into dist-cli/
	npm run build:cli

typecheck: ## Typecheck the backend/CLI via tsconfig.cli.json
	npm run typecheck

typecheck-frontend: ## Typecheck the frontend (needs frontend deps installed)
	npm run typecheck:frontend

test: ## Run backend + frontend suites
	npm test

test-backend: ## Run the backend suite only
	npm run test:backend

test-frontend: ## Run the frontend suite only
	npm run test:frontend

verify: ## Full gate: build:cli + typecheck + frontend build + frontend typecheck + both suites
	npm run verify

pack-inspect: ## Pack for real and assert the tarball ships the runtime surface
	npm run pack:inspect

release-check: ## Pre-tag guard: clean tree, pushed, version unpublished, tag free
	npm run release:check

clean: ## Remove build output (leaves node_modules alone)
	rm -rf dist-cli frontend/dist

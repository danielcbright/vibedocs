# Rename docs-browser to vibedocs — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the project from "docs-browser" to "vibedocs" across all files, directories, services, and GitHub.

**Architecture:** Pure rename — no logic changes. Stop old service, rename directory, update all references, reinstall service, rename GitHub repo, push.

**Tech Stack:** systemd, bash, git, gh CLI

---

### Task 1: Stop and Disable Old Service

**Step 1: Stop and disable the old systemd service**

```bash
systemctl --user stop docs-browser
systemctl --user disable docs-browser
```

Expected: Service stops, symlink removed from default.target.wants.

**Step 2: Remove old symlink**

```bash
rm ~/.config/systemd/user/docs-browser.service
systemctl --user daemon-reload
```

Expected: Old service fully unregistered.

---

### Task 2: Rename Project Directory

**Step 1: Rename the directory**

```bash
mv ~/claudebot/projects/docs-browser ~/claudebot/projects/vibedocs
```

Expected: `~/claudebot/projects/vibedocs/` exists, old path gone.

---

### Task 3: Update All File Contents

All edits use find-and-replace within each file. The mapping is:
- `docs-browser` → `vibedocs`
- `Docs Browser` → `VibeDocs`
- `Docs browser` → `VibeDocs`

**Files to update (project-level):**

- Modify: `package.json` — line 2: name field
- Modify: `CLAUDE.md` — ~15 references (title, service name, systemctl/journalctl commands, paths)
- Modify: `README.md` — ~5 references (title, paths, GitHub URL)
- Modify: `systemd/docs-browser.service` — lines 2, 8, 9, 18 (Description, WorkingDirectory, ExecStart, SyslogIdentifier)
- Modify: `scripts/setup-service.sh` — lines 6, 8, 10, 41, 47-49 (file refs, service name, echo messages)
- Modify: `scripts/promote.sh` — lines 8, 69, 71, 89-90, 99-100 (echo messages, systemctl commands)
- Modify: `docs/architecture.md` — line 5 (project name in description)

**Files to update (workspace-level):**

- Modify: `~/claudebot/CLAUDE.md` — lines 96-102 (Docs Browser section, paths, service commands)
- Modify: `~/claudebot/README.md` — lines 17, 152, 170, 178-179 (table, section, paths, GitHub URL)
- Modify: `~/claudebot/docs/port-registry.md` — line 16 (port entry)

**Step 1: Update project files**

For each file listed above, replace all occurrences:
- `docs-browser` → `vibedocs`
- `Docs Browser` → `VibeDocs`
- `Docs browser` → `VibeDocs`

**Step 2: Update workspace files**

Same replacements in the three workspace-level files.

---

### Task 4: Rename systemd Service File

**Step 1: Rename the file**

```bash
mv ~/claudebot/projects/vibedocs/systemd/docs-browser.service ~/claudebot/projects/vibedocs/systemd/vibedocs.service
```

Expected: `systemd/vibedocs.service` exists.

---

### Task 5: Install and Start New Service

**Step 1: Run setup script**

```bash
cd ~/claudebot/projects/vibedocs
./scripts/setup-service.sh
```

Expected: Symlink created at `~/.config/systemd/user/vibedocs.service`, service enabled.

**Step 2: Run promotion**

```bash
./scripts/promote.sh
```

Expected: Build succeeds, service starts, health check passes on `http://localhost:8080/api/projects`.

**Step 3: Verify**

```bash
systemctl --user status vibedocs
curl -sf http://localhost:8080/api/projects | head -c 100
```

Expected: Active (running), JSON response.

---

### Task 6: Rename GitHub Repo and Update Remote

**Step 1: Rename repo on GitHub**

```bash
cd ~/claudebot/projects/vibedocs
gh repo rename vibedocs
```

Expected: Repo renamed to `danielcbright/vibedocs`.

**Step 2: Update git remote**

```bash
git remote set-url origin https://github.com/danielcbright/vibedocs.git
```

**Step 3: Verify remote**

```bash
git remote -v
```

Expected: Both fetch and push point to `danielcbright/vibedocs.git`.

---

### Task 7: Commit and Push

**Step 1: Commit all changes**

```bash
cd ~/claudebot/projects/vibedocs
git add -A
git commit -m "Rename project from docs-browser to vibedocs"
git push origin main
```

**Step 2: Commit workspace changes**

```bash
cd ~/claudebot
git add README.md CLAUDE.md docs/port-registry.md
git commit -m "Rename docs-browser to vibedocs in workspace docs"
git push origin main
```

---

### Task 8: Final Verification

**Step 1: Service running**

```bash
systemctl --user status vibedocs
```

Expected: active (running)

**Step 2: Health check**

```bash
curl -sf http://localhost:8080/api/projects | python3 -m json.tool | head -5
```

Expected: JSON with project list

**Step 3: No stale references**

```bash
grep -r "docs-browser" ~/claudebot/projects/vibedocs/ --include="*.md" --include="*.json" --include="*.sh" --include="*.service" || echo "Clean"
grep -r "docs-browser" ~/claudebot/CLAUDE.md ~/claudebot/README.md ~/claudebot/docs/port-registry.md || echo "Clean"
```

Expected: "Clean" for both

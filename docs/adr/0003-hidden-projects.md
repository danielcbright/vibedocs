# Hidden projects: not listed, watched or searched, still served

**Status:** accepted (2026-10-07)

Making a folder of repositories a root (ADR-0002) also makes every git worktree in it a project. One real root held 35 projects, and 15 of them were linked worktrees. They are copies of repositories already indexed, so they clutter the sidebar and duplicate search hits. Their docs still need opening now and then.

## Decisions

- **A hidden project is still inside its root, so it is still served.** `/open`, `vibedocs open` and saved links keep working. Two narrower meanings lost:
  - **Removing it from the root**: that would put its docs outside every root, beyond what `/open` may serve.
  - **Hiding it from the sidebar only**: search hits would point at docs you cannot browse to, and nothing would be saved on memory.
- **Hidden means not listed, not watched and not indexed.** The watcher and the search walk are where duplicate trees cost memory, and that cost is what took the service down before.
- **Linked git worktrees are hidden automatically**, per root, with an opt-out. Detection reads the project's `.git` file and matches a `gitdir:` under `worktrees/`. We rejected name patterns such as `*-worktree-*`, which are one person's convention. A plain `.git` file match would also catch submodules.
- **Manual hide and show live in the roots file** as `hide`, `show` and `show-worktrees` lines. We rejected a second config file, which would have meant two things to keep in step and two writers. `show` overrides the worktree rule for a single project, and `hide` overrides everything.
- **Hiding never renames anything.** Visibility is decided after naming, so hiding a project in one root does not change the name of a project in another. Names are routing keys (ADR-0002).
- **The rule is one shared function** (`src/shared/project-visibility.ts`), so the Settings view previews exactly what the server will do.
- **Opening a doc in a hidden project shows its tree** in the sidebar, marked hidden, through a per-project tree endpoint. We rejected rendering only the doc, which would leave its neighbouring files unreachable.

## Consequences

- Hidden projects are decided at boot for the watcher. A worktree created later is left out of the list and the search index straight away, but is watched until the next restart.
- When roots come from `VIBEDOCS_ROOTS` rather than a file, worktrees are still hidden, but nothing can be hidden or shown by hand.
- A root that holds nothing but worktrees looks empty until its worktrees are shown. The boot log says how many it hid.

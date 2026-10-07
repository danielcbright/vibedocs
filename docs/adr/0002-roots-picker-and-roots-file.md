# Roots are chosen in a browser folder tree and kept in a roots file

**Status:** accepted (2026-10-07)

The macOS installer's picker listed only the top level of `~`, so a folder like `~/src/work` could not be a root without typing `--folders`. And because the selection lived in `VIBEDOCS_ROOTS` inside the LaunchAgent plist, changing it meant re-running the installer. Decided before implementation. The code is in `src/settings/`, `src/cli/pick-roots.ts` and `frontend/src/settings/`.

## Decisions

- **A checkbox folder tree in the browser, built from shadcn primitives** (Radix Checkbox plus the existing Collapsible). We rejected three terminal pickers in its favour: a drill-down, a typed path and a depth-2 list. We also rejected HeroUI and Astryx, because either would be a second design system beside shadcn.
- **One UI and one routes module, two hosts:** Settings in the live app, and a one-shot install page (`vibedocs pick-roots`) that the installer runs. The hosts differ only in what a save does next. We chose this over having the installer start the service and open its Settings: that way the installer stays the only writer of the plist, and a bad selection never reaches a running service.
- **Persisted in a roots file named by `VIBEDOCS_ROOTS_FILE`.** We rejected having the server rewrite its own plist, which would only work under launchd. `VIBEDOCS_ROOTS` still wins, and Settings is read-only when it does. Precedence lives in one function, `rootsSource`.
- **Applied by a supervised self-restart.** Under `VIBEDOCS_SUPERVISED` the server exits with 75 and launchd or systemd restarts it. Unsupervised, it saves and asks for a restart. We rejected hot-swapping, because `PROJECT_ROOTS` is a module-load snapshot that discovery, the watcher, search and the resolvers all read. `serve-live.ts` re-execs for the same reason.
- **This machine only, and off unless enabled.** The gate is a loopback peer, plus a loopback `Host`, plus our own `Origin` on writes. We rejected same-origin alone, which is the runs-control gate: a root of `~` serves every non-dot file, and same-origin would let any tailnet browser set one.
- **The server judges, and the picker only reports.** The picker shows the result of `checkRootSelection`, the same rule the server refuses to boot on, and never restates it.

## Consequences

- The installer's plist must not set `VIBEDOCS_ROOTS`, or Settings goes read-only.
- The roots file is `~/.vibedocs/roots.txt`. The name `~/.vibedocs/roots` belongs to the pre-#193 symlink directory, which an upgraded machine may still have.
- A reverse proxy on the same machine that forwards remote requests with a loopback `Host` defeats the gate. This is documented, not detected.

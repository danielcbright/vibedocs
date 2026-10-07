/**
 * Which top-level view the app is in.
 *
 * Deliberately NOT named ViewMode: `ViewMode` already exists in App.tsx for the
 * sidebar's file-type filter ("docs" | "all"), a different axis that happens to
 * share the value "docs". Two controls in the same sidebar header sharing a
 * name would be a trap.
 */
export type AppView = "docs" | "runs"

/** `#/settings`, like `#/runs`, sits in the empty-project namespace no directory can claim. */
export const SETTINGS_HASH = "/settings"

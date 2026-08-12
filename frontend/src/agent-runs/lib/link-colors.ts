import type { LinkKind, LinkState, RunLink } from "@shared/agent-run-types"

/**
 * Colour for a link chip, using GitHub's own conventions so the meaning is
 * already learned: merged is purple, open is green, closed is red, draft is
 * grey. Values are Primer's, with the dark-mode pair alongside each.
 *
 * State wins over kind when known. A link with no state is deliberately neutral
 * rather than optimistic — colouring an unknown PR green would assert something
 * nobody checked.
 */
const STATE_CLASS: Record<LinkState, string> = {
  // Primer: open green    #1a7f37 / #3fb950
  open: "text-[#1a7f37] border-[#1a7f37]/35 dark:text-[#3fb950] dark:border-[#3fb950]/35",
  // Primer: merged purple #8250df / #a371f7
  merged: "text-[#8250df] border-[#8250df]/35 dark:text-[#a371f7] dark:border-[#a371f7]/35",
  // Primer: closed red    #cf222e / #f85149
  closed: "text-[#cf222e] border-[#cf222e]/35 dark:text-[#f85149] dark:border-[#f85149]/35",
  // Primer: draft grey    #59636e / #656c76
  draft: "text-[#59636e] border-[#59636e]/35 dark:text-[#656c76] dark:border-[#656c76]/35",
}

/** Neutral, kind-only colouring for links whose state nobody has reported. */
const KIND_CLASS: Record<LinkKind, string> = {
  issue: "text-primary border-primary/30",
  pr: "text-primary border-primary/30",
  ci: "text-muted-foreground border-border",
  other: "text-muted-foreground border-border",
}

export function linkColorClass(link: RunLink): string {
  return link.state ? STATE_CLASS[link.state] : KIND_CLASS[link.kind] ?? KIND_CLASS.other
}

/** Tooltip text: the label alone does not say what state it is in. */
export function linkTitle(link: RunLink): string {
  return link.state ? `${link.label} — ${link.state}` : link.label
}

import { CircleDot, ExternalLink, GitPullRequest, PlayCircle } from "lucide-react"
import type { LinkKind, RunLink } from "@shared/agent-run-types"
import { cn } from "@/lib/utils"

const KIND_ICON = {
  issue: CircleDot, pr: GitPullRequest, ci: PlayCircle, other: ExternalLink,
} as const satisfies Record<LinkKind, unknown>

/**
 * Link chips. Rendered inside the rail row's button, so each stops propagation:
 * clicking the row selects the run, clicking a link opens it.
 */
export function RunLinks({ links, size = "md" }: { links: RunLink[]; size?: "sm" | "md" }) {
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {links.map((link) => {
        const Icon = KIND_ICON[link.kind] ?? ExternalLink
        return (
          <a
            key={`${link.kind}:${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-[1px] text-primary transition-colors hover:bg-accent",
              size === "sm" ? "text-[10.5px]" : "text-[11px]",
            )}
          >
            <Icon className="h-3 w-3" />
            {link.label}
          </a>
        )
      })}
    </div>
  )
}


/**
 * The single most identifying link, for a rail row.
 *
 * A rail row shows one link, not all of them: the issue key is what an operator
 * scans for, and a row of chips turns the rail into a wall. The full set lives
 * in the detail header. Issue wins, then PR, then whatever is first.
 */
export function PrimaryLink({ links }: { links: RunLink[] }) {
  if (links.length === 0) return null
  const link = links.find((l) => l.kind === "issue") ?? links.find((l) => l.kind === "pr") ?? links[0]
  const Icon = KIND_ICON[link.kind] ?? ExternalLink
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] text-primary transition-colors hover:bg-accent"
    >
      <Icon className="h-2.5 w-2.5" />
      {link.label}
    </a>
  )
}

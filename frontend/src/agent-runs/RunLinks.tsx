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
 * The links a rail row carries: the issue key and the PR, at most.
 *
 * Not all of them — a full chip set turns the rail into a wall, and CI runs and
 * one-offs belong in the detail header. But not just one either: the issue key
 * is what you scan for while work is in flight, and the PR is the outcome you
 * look for once it is finished, so a done run showing only its ticket hides the
 * thing you actually came for.
 */
export function railLinks(links: readonly RunLink[]): RunLink[] {
  const issue = links.find((l) => l.kind === "issue")
  const pr = links.find((l) => l.kind === "pr")
  const picked = [issue, pr].filter((l): l is RunLink => l !== undefined)
  // No issue and no PR: fall back to the first link rather than showing none.
  return picked.length > 0 ? picked : links.slice(0, 1)
}

export function RailLinks({ links }: { links: RunLink[] }) {
  const picked = railLinks(links)
  if (picked.length === 0) return null
  return (
    <span className="flex shrink-0 items-center gap-1">
      {picked.map((link) => {
        const Icon = KIND_ICON[link.kind] ?? ExternalLink
        return (
          <a
            key={`${link.kind}:${link.url}`}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
            title={link.label}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-[1px] text-[10px] text-primary transition-colors hover:bg-accent"
          >
            <Icon className="h-2.5 w-2.5" />
            {link.label}
          </a>
        )
      })}
    </span>
  )
}

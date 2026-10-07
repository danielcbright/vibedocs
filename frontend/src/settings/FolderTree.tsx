import { useEffect, useState } from "react"
import { ChevronRight, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { FolderEntry, FolderListing } from "@shared/settings-types"
import { projectVisibility, type VisibilityRules } from "@shared/project-visibility"
import type { SettingsClient } from "./settings-client"

/**
 * A lazily loaded tree of folders with a checkbox per row. One level is fetched
 * when a folder is first opened, so the tree costs nothing below what is looked at.
 *
 * Checkbox state is display only: checked when the folder is chosen,
 * indeterminate when something below it is. Whether a selection can work — two
 * roots sharing a name, one inside another — is the server's call, made by the
 * caller through `check`, so no rule is restated here.
 *
 * The folders inside a chosen root are its projects, and each gets a show/hide
 * toggle (ADR-0003). Whether one is hidden comes from `projectVisibility`, the
 * function the server decides with.
 */
export interface FolderTreeProps {
  client: SettingsClient
  /** The folder whose children form the top level. */
  root: string
  selected: readonly string[]
  onToggle: (path: string, checked: boolean) => void
  /** Draft hide/show rules, previewed on the projects of chosen roots. */
  rules: VisibilityRules
  onToggleHidden: (projectDir: string, root: string, isWorktree: boolean) => void
  disabled?: boolean
}

export function FolderTree(props: FolderTreeProps) {
  return (
    <div className="rounded-md border text-sm" data-testid="folder-tree">
      <FolderLevel {...props} path={props.root} depth={0} />
    </div>
  )
}

interface LevelProps extends FolderTreeProps {
  path: string
  depth: number
}

function FolderLevel({ path, depth, ...props }: LevelProps) {
  const [listing, setListing] = useState<FolderListing | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { client } = props
  useEffect(() => {
    let cancelled = false
    client
      .listFolders(path)
      .then((l) => !cancelled && setListing(l))
      .catch((err: Error) => !cancelled && setError(err.message))
    return () => {
      cancelled = true
    }
  }, [client, path])

  const indent = { paddingLeft: `${depth * 1.25 + 0.5}rem` }
  if (error) {
    return (
      <p className="py-1.5 pr-2 text-xs text-destructive" style={indent} role="alert">
        {error}
      </p>
    )
  }
  if (!listing) {
    return (
      <p className="flex items-center gap-1.5 py-1.5 pr-2 text-xs text-muted-foreground" style={indent}>
        <Loader2 className="size-3 animate-spin" /> Loading…
      </p>
    )
  }
  if (listing.folders.length === 0) {
    return (
      <p className="py-1.5 pr-2 text-xs text-muted-foreground" style={indent}>
        No folders here.
      </p>
    )
  }
  const parentChosen = props.selected.includes(path)
  return (
    <ul role="group" className={depth === 0 ? "py-1" : undefined}>
      {listing.folders.map((f) => (
        <FolderRow key={f.path} folder={f} depth={depth} parent={path} parentChosen={parentChosen} {...props} />
      ))}
    </ul>
  )
}

interface RowProps extends FolderTreeProps {
  folder: FolderEntry
  depth: number
  /** The folder this row sits in. */
  parent: string
  /** The folder holding this one is a chosen root, which makes this one of its projects. */
  parentChosen: boolean
}

function FolderRow({ folder, depth, parent, parentChosen, ...props }: RowProps) {
  const [open, setOpen] = useState(false)
  const chosen = props.selected.includes(folder.path)
  const below = props.selected.some((s) => s.startsWith(folder.path + "/"))
  const id = `folder-${folder.path}`
  const visibility = parentChosen ? projectVisibility(folder.path, parent, folder.worktree, props.rules) : null

  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="group flex items-center gap-2 py-1 pr-3 hover:bg-accent/40 tap-row"
          style={{ paddingLeft: `${depth * 1.25 + 0.25}rem` }}
        >
          <CollapsibleTrigger
            className="tap-target flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={`${open ? "Collapse" : "Expand"} ${folder.name}`}
          >
            <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </CollapsibleTrigger>
          <Checkbox
            id={id}
            checked={chosen ? true : below ? "indeterminate" : false}
            disabled={props.disabled}
            onCheckedChange={(v) => props.onToggle(folder.path, v === true)}
            aria-label={`Use ${folder.path} as a root`}
          />
          <label
            htmlFor={id}
            className={cn("min-w-0 flex-1 cursor-pointer truncate", visibility?.hidden && "text-muted-foreground line-through decoration-muted-foreground/50")}
            title={folder.path}
          >
            {folder.name}
          </label>
          {folder.worktree && (
            <span
              className="shrink-0 rounded border border-border px-1.5 text-[10px] text-muted-foreground"
              title="A linked git worktree: hidden by default when it is a project"
            >
              worktree
            </span>
          )}
          {visibility && (
            <>
              <span
                className={cn(
                  "shrink-0 rounded px-1.5 text-[10px] font-medium",
                  visibility.hidden ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                )}
                title={
                  visibility.hidden
                    ? "Hidden: not listed, watched or searched. Its docs still open by path."
                    : "A project of the root above"
                }
              >
                {visibility.hidden ? "hidden" : "project"}
              </span>
              <button
                type="button"
                className="tap-target flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                aria-label={`${visibility.hidden ? "Show" : "Hide"} ${folder.path}`}
                aria-pressed={visibility.hidden}
                disabled={props.disabled}
                onClick={() => props.onToggleHidden(folder.path, parent, folder.worktree)}
              >
                {visibility.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </>
          )}
          {folder.protected && (
            <span
              className="flex shrink-0 items-center gap-1 text-[11px] text-amber-700 dark:text-amber-400"
              title="Protected by macOS privacy controls. The background service needs Full Disk Access granted to node to read it."
            >
              <ShieldAlert className="size-3" /> Full Disk Access
            </span>
          )}
          <span
            className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
            title="Markdown files within four levels of this folder"
          >
            {folder.markdown === null ? "—" : `${folder.markdown.toLocaleString()}${folder.capped ? "+" : ""} md`}
          </span>
        </div>
        <CollapsibleContent>
          <FolderLevel {...props} path={folder.path} depth={depth + 1} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

import { useEffect, useState } from "react"
import { ChevronRight, Loader2, ShieldAlert } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { FolderEntry, FolderListing } from "@shared/settings-types"
import type { SettingsClient } from "./settings-client"

/**
 * A lazily loaded tree of folders with a checkbox per row. One level is fetched
 * when a folder is first opened, so the tree costs nothing below what is looked at.
 *
 * Checkbox state is display only: checked when the folder is chosen,
 * indeterminate when something below it is. Whether a selection can work — two
 * roots sharing a name, one inside another — is the server's call, made by the
 * caller through `check`, so no rule is restated here.
 */
export interface FolderTreeProps {
  client: SettingsClient
  /** The folder whose children form the top level. */
  root: string
  selected: readonly string[]
  onToggle: (path: string, checked: boolean) => void
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
        <FolderRow key={f.path} folder={f} depth={depth} parentChosen={parentChosen} {...props} />
      ))}
    </ul>
  )
}

interface RowProps extends FolderTreeProps {
  folder: FolderEntry
  depth: number
  /** The folder holding this one is a chosen root, which makes this one of its projects. */
  parentChosen: boolean
}

function FolderRow({ folder, depth, parentChosen, ...props }: RowProps) {
  const [open, setOpen] = useState(false)
  const chosen = props.selected.includes(folder.path)
  const below = props.selected.some((s) => s.startsWith(folder.path + "/"))
  const id = `folder-${folder.path}`

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
          <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer truncate" title={folder.path}>
            {folder.name}
          </label>
          {parentChosen && (
            <span className="shrink-0 rounded bg-primary/10 px-1.5 text-[10px] font-medium text-primary">project</span>
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
